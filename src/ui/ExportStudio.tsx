// ui 層：出圖工作室
//
// 全螢幕覆蓋層：左邊 70% 即時預覽，右邊 30% 設定。
// 給「做簡報用的資訊圖表」這個情境：選版型、比例、主題、標題、要放哪些內容，
// 預覽就是下載下來的樣子，按下去直接得到可以貼進 Keynote／PowerPoint 的圖。
//
// 這裡只管「使用者選了什麼」；怎麼畫交給 render（離屏渲染），怎麼存成檔案交給 adapters。

import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  copyPngToClipboard,
  downloadBlob,
  downloadText,
  safePngScale,
  serializeSvg,
} from '../adapters/export'
import { embeddedFontCssForText, missingGlyphNote, svgToPngWithFonts } from '../adapters/fonts'
import type { Layer } from '../compose/useLayers'
import { featuredOnly } from '../compose/sourceFilters'
import { sourcesFor } from '../compose/useLayers'
import { isFeatured } from '../core'
import type { CalloutSpec } from '../render/callouts'
import {
  renderChronicleExportSvg,
  renderHorizontalExportSvg,
  renderVerticalExportSvg,
  renderWithAutoHeight,
} from '../render/exportSvg'
import type { RenderTheme, ThemeId } from '../render/theme'
import { deriveTheme, THEMES } from '../render/theme'
import { estimateTextWidth } from '../render/layout'
import { buildBands, buildTimelineBase } from '../render/timelineData'
import type { RatioId } from './ratios'
import { RATIO_PRESETS } from './ratios'
import { eventGroups, MAX_PAGES, planPages } from './splitPages'
import {
  clearStudioSettings,
  docsToLayerIds,
  layerIdsToDocs,
  loadStudioSettings,
  saveStudioSettings,
  toDocKey,
  toLayerKey,
} from './studioSettings'
import { StudioPreview } from './StudioPreview'

/** 固定比例放不下時，文字最多自動縮到主題原本大小的多少（再小就讀不清楚） */
const MIN_FIT_SCALE = 0.6

/** 自動縮字要試的倍率：從使用者設定的大小開始，每次少 10%，到下限為止 */
function fitScales(start: number): number[] {
  const out = [start]
  for (let s = Math.round(start * 10 - 1) / 10; s >= MIN_FIT_SCALE - 1e-9; s = Math.round(s * 10 - 1) / 10) {
    if (s < start) out.push(s)
  }
  return out
}

/** 四種版型（見 docs/ui-upgrade-plan.md 第 0.7 節） */
type LayoutId = 'A' | 'D' | 'B' | 'C'
const LAYOUTS: Array<{ id: LayoutId; label: string; hint: string; ready: boolean }> = [
  { id: 'A', label: 'A 多軸泳道', hint: '跨主體的橫向交互作用', ready: true },
  { id: 'D', label: 'D 直式大事記', hint: '深度證據鏈與脈絡錨定', ready: true },
  { id: 'B', label: 'B 雙向對照', hint: '二元對抗與矛盾檢驗', ready: true },
  { id: 'C', label: 'C 因果魚骨', hint: '多重因果匯聚', ready: false },
]

const THEME_OPTIONS: Array<{ id: ThemeId; label: string }> = [
  { id: 'presentation', label: '簡報（淺底）' },
  { id: 'presentation-dark', label: '簡報（深底）' },
  { id: 'screen', label: '螢幕' },
  { id: 'print', label: '列印' },
]

type RangeKind = 'view' | 'all' | 'years'
/** 呈現哪些事件：全部，或只放關鍵事件（★ featured） */
type EventScope = 'all' | 'featured'

/** 標註框最多幾個（計畫書：6–8 個，再多圖就亂了） */
const MAX_CALLOUTS = 8

/** 摘要的預設值：事件描述的前 40 字 */
function defaultSummary(description: string | undefined, maxChars = 40): string {
  const text = (description ?? '').replace(/\s+/g, ' ').trim()
  return text.length > maxChars ? text.slice(0, maxChars - 1) + '…' : text
}

/**
 * 標註框的摘要最多放得下幾個中文字（兩行）。框寬：橫式 200、直式 160，扣掉左右內距，
 * 摘要字級 11（全都跟著主題倍率一起放大，所以倍率互相抵消）。英數字算半個字
 */
function summaryCapacity(horizontal: boolean): number {
  return Math.floor(((horizontal ? 200 : 160) - 16) / 11) * 2
}
/** 摘要大約佔幾個中文字寬（英數字算半個） */
function summaryUsed(text: string): number {
  return Math.ceil(estimateTextWidth(text, 1))
}

/** 比例：十種固定比例，或「自動長度」（寬度固定、高度拉長到全部放得下） */
type RatioChoice = RatioId | 'auto'
/** 自動長度的寬度：泳道沿用 16:9 的寬、直式沿用 A4 的寬 */
const AUTO_WIDTH = { horizontal: 960, vertical: 620, contrast: 900 }
/** 自動長度最多拉到多高（再長瀏覽器畫不出來，PNG 也會自動降解析度） */
const AUTO_MAX_H = 40_000

interface Props {
  open: boolean
  onClose: () => void
  layers: Layer[]
  /** 面板上被隱藏的軸線（「圖層 id/軸線 id」）——工作室的預設勾選跟目前畫面一樣 */
  hiddenTracks: ReadonlySet<string>
  /** 目前畫面的可視範圍（壓縮座標 u） */
  viewDomain: [number, number] | null
  orientation: 'horizontal' | 'vertical'
  showDates: boolean
  showYears: boolean
  showRelations: boolean
  collapseGaps: boolean
  compact: boolean
  reversed: boolean
  centerAxis: boolean
}

/** 今天的日期（出處行用） */
function todayText(): string {
  const d = new Date()
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}

export function ExportStudio(props: Props) {
  const { open, onClose, layers, hiddenTracks, viewDomain, orientation } = props

  // ---- 設定 ----
  // 上次的設定（存在這個瀏覽器）：關掉再打開、重新整理頁面都接著用，改一個字不必整張重做
  const [saved] = useState(() => loadStudioSettings())
  const pick = <T,>(value: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(value as T) ? (value as T) : fallback
  const defaultLayout: LayoutId = orientation === 'vertical' ? 'D' : 'A'
  const [layout, setLayout] = useState<LayoutId>(() =>
    pick(saved?.layout, LAYOUTS.filter((l) => l.ready).map((l) => l.id), defaultLayout),
  )
  // 版型 B 的方向：上下對照（橫式）或左右對照（直式）
  const [bDir, setBDir] = useState<'h' | 'v'>(
    () => saved?.bDir ?? (orientation === 'vertical' ? 'v' : 'h'),
  )
  // 預設「自動長度」：全部軸線與事件都放得下，不會一打開就被裁掉
  const [ratioId, setRatioId] = useState<RatioChoice>(() =>
    pick(saved?.ratioId, ['auto', ...RATIO_PRESETS.map((r) => r.id)] as RatioChoice[], 'auto'),
  )
  const [themeId, setThemeId] = useState<ThemeId>(() =>
    pick(saved?.themeId, Object.keys(THEMES) as ThemeId[], 'presentation'),
  )
  const [fontScale, setFontScale] = useState(() => saved?.fontScale ?? 1)
  // 固定比例放不下全部事件時：自動縮小文字，或依時間切成好幾張同樣比例的圖
  const [overflowMode, setOverflowMode] = useState<'shrink' | 'split'>(() => saved?.overflowMode ?? 'shrink')
  // 切成多張時，預覽正在看第幾張（從 0 起算）
  const [pageIdx, setPageIdx] = useState(0)
  // 使用者自己打的標題／副標／出處；null = 沒改過，跟著勾選的資料自動帶入
  const [customTitle, setCustomTitle] = useState<string | null>(() => saved?.title ?? null)
  const [customSubtitle, setCustomSubtitle] = useState<string | null>(() => saved?.subtitle ?? null)
  const [customFooter, setCustomFooter] = useState<string | null>(() => saved?.footer ?? null)
  const [layerOn, setLayerOn] = useState<Set<string>>(new Set())
  const [trackOff, setTrackOff] = useState<Set<string>>(new Set())
  const [rangeKind, setRangeKind] = useState<RangeKind>(() =>
    pick(saved?.rangeKind, ['view', 'all', 'years'] as RangeKind[], 'view'),
  )
  const [fromYear, setFromYear] = useState(() => saved?.fromYear ?? '')
  const [toYear, setToYear] = useState(() => saved?.toYear ?? '')
  // 日期顯示：年、月、日分別勾選（預設跟主畫面的「顯示事件日期／含年份」一致）
  const [dateYear, setDateYear] = useState(() => saved?.dateYear ?? (props.showDates && props.showYears))
  const [dateMonth, setDateMonth] = useState(() => saved?.dateMonth ?? props.showDates)
  const [dateDay, setDateDay] = useState(() => saved?.dateDay ?? props.showDates)
  // 精確到分鐘的事件：社群圖通常不需要「09:00」，預設不寫
  const [dateTime, setDateTime] = useState(() => saved?.dateTime ?? false)
  // 出圖預設不畫關係線：簡報圖要乾淨，需要時再勾
  const [showRelations, setShowRelations] = useState(() => saved?.showRelations ?? false)
  const [collapseGaps, setCollapseGaps] = useState(() => saved?.collapseGaps ?? props.collapseGaps)
  // 順序等距：事件依先後等距排列（圖上固定標「非等比」）；卡片大事記本來就依先後排，不適用
  const [ordinal, setOrdinal] = useState(() => saved?.ordinal ?? false)
  const [compact, setCompact] = useState(() => saved?.compact ?? props.compact)
  const [reversed, setReversed] = useState(() => saved?.reversed ?? props.reversed)
  const [centerAxis, setCenterAxis] = useState(() => saved?.centerAxis ?? props.centerAxis)
  const [embedFontsInSvg, setEmbedFontsInSvg] = useState(() => saved?.embedFontsInSvg ?? false)
  // 版型 D：卡片大事記（依先後排列）或照時間比例的直式長圖
  const [cardMode, setCardMode] = useState(() => saved?.cardMode ?? true)
  // 卡片上的小字預設都不顯示，要時再勾
  const [showConfidence, setShowConfidence] = useState(() => saved?.showConfidence ?? false)
  const [showSources, setShowSources] = useState(() => saved?.showSources ?? false)
  // 標註框：勾了哪些事件（依勾選順序），以及每個框的一句摘要（使用者可改）
  const [calloutKeys, setCalloutKeys] = useState<string[]>([])
  const [calloutText, setCalloutText] = useState<Record<string, string>>({})
  // 呈現哪些事件；只放關鍵事件時，圖上預設註明「僅列關鍵事件（N 件中的 M 件）」（可關）
  const [eventScope, setEventScope] = useState<EventScope>(() => saved?.eventScope ?? 'all')
  const [showScopeNote, setShowScopeNote] = useState(() => saved?.showScopeNote ?? true)

  // 圖層、軸線、標註要等拿到目前的圖層才對得上：第一次打開時從上次的設定換算回來，
  // 之後再打開就保留使用者在工作室裡的勾選，只把「新載入、主畫面上顯示中」的圖層一併勾上
  const initialized = useRef(false)
  const knownLayers = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!open) return
    const visible = layers.filter((l) => l.visible)
    if (!initialized.current) {
      initialized.current = true
      const fromSaved = saved ? docsToLayerIds(saved.layerDocs, layers) : []
      if (saved && fromSaved.length > 0) {
        setLayerOn(new Set(fromSaved))
        setTrackOff(new Set(saved.trackOffDocs.flatMap((k) => toLayerKey(k, layers) ?? [])))
        setCalloutKeys(saved.callouts.flatMap((k) => toLayerKey(k, layers) ?? []))
        setCalloutText(
          Object.fromEntries(
            Object.entries(saved.calloutText).flatMap(([k, v]) => {
              const key = toLayerKey(k, layers)
              return key ? [[key, v]] : []
            }),
          ),
        )
      } else {
        // 第一次用（或上次的資料都不在了）：跟目前畫面一樣
        setLayerOn(new Set(visible.map((l) => l.id)))
        setTrackOff(new Set(hiddenTracks))
      }
    } else {
      setLayerOn((prev) => {
        const next = new Set([...prev].filter((id) => layers.some((l) => l.id === id)))
        for (const l of visible) if (!knownLayers.current.has(l.id)) next.add(l.id)
        return next
      })
    }
    knownLayers.current = new Set(layers.map((l) => l.id))
    // 「目前畫面看到的那一段」要有主畫面的範圍才能用
    if (!viewDomain) setRangeKind((k) => (k === 'view' ? 'all' : k))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  /** 「恢復預設設定」：丟掉記住的設定，全部回到第一次打開的樣子 */
  const resetAll = () => {
    clearStudioSettings()
    const visible = layers.filter((l) => l.visible)
    setLayout(defaultLayout)
    setBDir(orientation === 'vertical' ? 'v' : 'h')
    setRatioId('auto')
    setThemeId('presentation')
    setFontScale(1)
    setOverflowMode('shrink')
    setCustomTitle(null)
    setCustomSubtitle(null)
    setCustomFooter(null)
    setLayerOn(new Set(visible.map((l) => l.id)))
    setTrackOff(new Set(hiddenTracks))
    setRangeKind(viewDomain ? 'view' : 'all')
    setFromYear('')
    setToYear('')
    setDateYear(props.showDates && props.showYears)
    setDateMonth(props.showDates)
    setDateDay(props.showDates)
    setDateTime(false)
    setShowRelations(false)
    setCollapseGaps(props.collapseGaps)
    setOrdinal(false)
    setCompact(props.compact)
    setReversed(props.reversed)
    setCenterAxis(props.centerAxis)
    setEmbedFontsInSvg(false)
    setCardMode(true)
    setShowConfidence(false)
    setShowSources(false)
    setCalloutKeys([])
    setCalloutText({})
    setEventScope('all')
    setShowScopeNote(true)
  }

  // Esc 關閉
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const auto = ratioId === 'auto'
  const preset = RATIO_PRESETS.find((r) => r.id === ratioId) ?? RATIO_PRESETS[5]
  // 目前要畫的寬度（自動長度時高度要畫了才知道）
  // 橫式：版型 A，或版型 B 的上下對照；其他都是直式
  const horizontal = layout === 'A' || (layout === 'B' && bDir === 'h')
  // 標註框摘要最多放得下幾個字（直式的框比較窄）
  const summaryCap = summaryCapacity(horizontal)
  // 左右對照是兩欄並排，一欄只有半張寬，自動長度給寬一點標題才放得下
  const drawW = auto
    ? horizontal
      ? AUTO_WIDTH.horizontal
      : layout === 'B'
        ? AUTO_WIDTH.contrast
        : AUTO_WIDTH.vertical
    : preset.w
  const theme = useMemo(
    () => deriveTheme(THEMES[themeId], { scale: THEMES[themeId].scale * fontScale }),
    [themeId, fontScale],
  )
  // 勾選的圖層與軸線 → 再依「呈現哪些事件」篩選，才是要畫的資料
  const baseSources = useMemo(
    () => sourcesFor(layers, (l) => layerOn.has(l.id), trackOff),
    [layers, layerOn, trackOff],
  )
  const sources = useMemo(
    () => (eventScope === 'featured' ? featuredOnly(baseSources) : baseSources),
    [baseSources, eventScope],
  )

  // 標註框的候選事件，依軸線分組（跟圖上同一套軸線名與顏色）；
  // 每組裡關鍵事件排前面，其餘依時間先後
  const calloutGroups = useMemo(() => {
    const base = buildTimelineBase(sources, collapseGaps)
    return buildBands(sources, base, { showDates: false, showYears: false }, theme.palette).map((band) => ({
      key: band.key,
      label: band.label,
      color: band.color,
      items: band.events
        .map((pe) => ({
          key: `${band.sourceId}/${pe.ev.id}`,
          title: pe.ev.title,
          featured: isFeatured(pe.ev),
          description: pe.ev.description,
          t: pe.tStart,
        }))
        .sort((a, b) => Number(b.featured) - Number(a.featured) || a.t - b.t),
    }))
  }, [sources, collapseGaps, theme.palette])
  const calloutCandidates = useMemo(() => calloutGroups.flatMap((g) => g.items), [calloutGroups])
  const calloutSpecs: CalloutSpec[] = calloutKeys.flatMap((key) => {
    const c = calloutCandidates.find((x) => x.key === key)
    return c ? [{ key, title: c.title, summary: calloutText[key] ?? defaultSummary(c.description, summaryCap) }] : []
  })

  // 「全部」的起訖年份，拿來當自訂年份的預設值
  const fullYears = useMemo(() => {
    if (sources.length === 0) return null
    const { warp, initialDomain } = buildTimelineBase(sources, collapseGaps)
    return initialDomain.map((u) => new Date(warp.toT(u)).getFullYear()) as [number, number]
  }, [sources, collapseGaps])

  const timeRange = useMemo((): [number, number] | undefined => {
    if (rangeKind !== 'years') return undefined
    const a = parseInt(fromYear, 10)
    const b = parseInt(toYear, 10)
    if (!Number.isFinite(a) || !Number.isFinite(b)) return undefined
    return [new Date(Math.min(a, b), 0, 1).getTime(), new Date(Math.max(a, b) + 1, 0, 1).getTime()]
  }, [rangeKind, fromYear, toYear])

  // 「目前畫面看到的那一段」換算成真實時間。
  // 主畫面回報的範圍是它自己的座標（含空白摺疊）；工作室篩掉軸線或事件後摺疊方式會不同，
  // 直接沿用座標會對到別的年份——所以先用主畫面的資料換回真實的年月日
  const screenTimeRange = useMemo((): [number, number] | undefined => {
    if (!viewDomain) return undefined
    const main = sourcesFor(layers, (l) => l.visible, hiddenTracks)
    if (main.length === 0) return undefined
    const { warp } = buildTimelineBase(main, props.collapseGaps)
    return [warp.toT(viewDomain[0]), warp.toT(viewDomain[1])]
  }, [viewDomain, layers, hiddenTracks, props.collapseGaps])
  // 實際要畫的時間範圍（真實時間）；undefined = 全部
  const effectiveRange = useMemo(
    () => (rangeKind === 'view' ? screenTimeRange : rangeKind === 'years' ? timeRange : undefined),
    [rangeKind, screenTimeRange, timeRange],
  )

  // 這段時間範圍裡一共幾件、其中幾件是關鍵事件（「僅列關鍵事件」的註記與提醒用）
  const scopeCounts = useMemo(() => {
    if (baseSources.length === 0) return { total: 0, featured: 0 }
    const base = buildTimelineBase(baseSources, collapseGaps)
    const [d0, d1] = effectiveRange
      ? [base.warp.toU(effectiveRange[0]), base.warp.toU(effectiveRange[1])]
      : base.initialDomain
    let total = 0
    let featured = 0
    for (const band of buildBands(baseSources, base, { showDates: false, showYears: false })) {
      for (const pe of band.events) {
        const uEnd = pe.kind === 'bar' ? base.warp.toU(pe.tEnd) : pe.u
        if (uEnd < d0 || pe.u > d1) continue
        total++
        if (pe.isKey) featured++
      }
    }
    return { total, featured }
  }, [baseSources, collapseGaps, effectiveRange])
  const scopeNote =
    eventScope === 'featured' && showScopeNote
      ? `僅列關鍵事件（${scopeCounts.total} 件中的 ${scopeCounts.featured} 件）`
      : undefined

  const useOrdinal = ordinal && !(layout === 'D' && cardMode)

  // 切成多張圖用：要畫的整段範圍（時間軸座標）、每件事件的起點、標註事件的位置
  const splitBasis = useMemo(() => {
    if (sources.length === 0) return null
    const base = buildTimelineBase(sources, collapseGaps, useOrdinal)
    const domain: [number, number] = effectiveRange
      ? [base.warp.toU(effectiveRange[0]), base.warp.toU(effectiveRange[1])]
      : base.initialDomain
    const starts: number[] = []
    const uOf = new Map<string, number>()
    for (const band of buildBands(sources, base, { showDates: false, showYears: false })) {
      for (const pe of band.events) {
        uOf.set(`${band.sourceId}/${pe.ev.id}`, pe.u)
        const uEnd = pe.kind === 'bar' ? base.warp.toU(pe.tEnd) : pe.u
        if (uEnd < domain[0] || pe.u > domain[1]) continue
        // 範圍開始前就開始的長期事件，算在第一張
        starts.push(Math.max(pe.u, domain[0]))
      }
    }
    return { domain, groups: eventGroups(starts), uOf }
  }, [sources, collapseGaps, effectiveRange, useOrdinal])

  // 標註的事件被篩掉了（例如改成只放關鍵事件），就自動取消它的勾選
  useEffect(() => {
    setCalloutKeys((prev) => {
      const next = prev.filter((k) => calloutCandidates.some((c) => c.key === k))
      return next.length === prev.length ? prev : next
    })
  }, [calloutCandidates])

  /** 「跟主畫面一樣」：圖層、軸線、時間範圍、呈現的事件都回到主畫面的樣子 */
  const matchScreen = () => {
    setLayerOn(new Set(layers.filter((l) => l.visible).map((l) => l.id)))
    setTrackOff(new Set(hiddenTracks))
    setRangeKind(viewDomain ? 'view' : 'all')
    setEventScope('all')
  }

  // 標題、副標、出處：沒自己改過就跟著勾選的資料自動帶入
  const selectedLayers = layers.filter((l) => layerOn.has(l.id))
  const autoTitle =
    selectedLayers.length === 1
      ? selectedLayers[0].doc.meta.title
      : selectedLayers.length > 1
        ? `${selectedLayers[0].doc.meta.title} 等 ${selectedLayers.length} 份`
        : 'HackStory'
  const autoSubtitle = selectedLayers[0]?.doc.meta.subtitle ?? ''
  const autoFooter = defaultFooter(selectedLayers)
  // 標題清空了就用自動的；副標可以刻意留空
  const titleText = customTitle?.trim() || autoTitle
  const subtitleText = (customSubtitle ?? autoSubtitle).trim()
  // 出處行不可關閉（誠實與可信原則）：清空了就退回預設
  const footerText = customFooter?.trim() || autoFooter

  // ---- 產生圖片（預覽與下載共用同一份設定） ----
  type Page = { svg: SVGSVGElement; w: number; h: number }
  type Rendered = {
    /** 一張，或切成多張時依時間先後的每一張 */
    pages: Page[]
    warnings: string[]
    /** 不是問題、但要讓人知道的事（例如文字自動縮小了） */
    info?: string
    /** 有事件放不下、不能下載的原因 */
    blocked?: string
  }
  /** 畫一次的結果；lost = 有事件沒畫出來的原因 */
  type Drawn = Page & { warnings: string[]; lost?: string }
  /** 切成多張時，這一張要畫的範圍與頁碼 */
  type PageSpec = { domain: [number, number]; label: string; first: boolean }

  const single = (d: Drawn, extra: Partial<Rendered> = {}): Rendered => ({
    pages: [{ svg: d.svg, w: d.w, h: d.h }],
    warnings: d.warnings,
    ...extra,
  })
  // 建議的其他做法：已經在用的就不要再叫使用者去做（例如已經勾了「只放關鍵事件」）
  const otherWays = `改選「自動長度」、縮短時間範圍、取消勾選部分軸線${eventScope === 'featured' ? '' : '，或只放關鍵事件'}`

  /**
   * 固定比例：選了要呈現的事件就一定要全部出現在圖上，否則是沒用的圖。
   * 放不下時看使用者選哪種做法：把文字一格一格縮小，或依時間切成好幾張；都不行就不給下載。
   */
  const renderCurrent = async (): Promise<Rendered> => {
    if (sources.length === 0) throw new Error('沒有勾選任何圖層或軸線')
    if (auto) {
      const d = await renderWith(theme)
      return single(d, d.lost ? { warnings: [...d.warnings, d.lost] } : {})
    }
    if (overflowMode === 'split') return renderSplit()
    const base = THEMES[themeId]
    let last: Rendered | null = null
    for (const s of fitScales(fontScale)) {
      const t = s === fontScale ? theme : deriveTheme(base, { scale: base.scale * s })
      const d = await renderWith(t)
      if (!d.lost) {
        return single(
          d,
          s < fontScale
            ? { info: `為了放下全部事件，文字自動縮為 ${Math.round(s * 100)}%（你設定的是 ${Math.round(fontScale * 100)}%）` }
            : {},
        )
      }
      last = single(d, {
        blocked: `文字自動縮到 ${Math.round(MIN_FIT_SCALE * 100)}% 還是放不下全部事件（${d.lost}），這個比例不能下載——可以改成「切分成多張圖」，或${otherWays}`,
      })
    }
    return last!
  }

  /** 依時間前後切成好幾張同樣比例的圖，文字維持設定的大小，張數最少 */
  const renderSplit = async (): Promise<Rendered> => {
    const whole = await renderWith(theme)
    if (!whole.lost || !splitBasis) return single(whole)
    // 試畫時先放最長的頁碼佔位：定稿的頁碼不會更長，試的時候放得下，定稿就一定放得下
    const probeLabel = `第 ${MAX_PAGES}／${MAX_PAGES} 張`
    const plan = await planPages(splitBasis.groups, splitBasis.domain, async (domain) => {
      const d = await renderWith(theme, { domain, label: probeLabel, first: domain[0] === splitBasis.domain[0] })
      return !d.lost
    })
    if (!plan.ok) {
      return single(whole, {
        blocked:
          plan.reason === 'too-many-pages'
            ? `要切成超過 ${MAX_PAGES} 張才放得下全部事件，這個比例不能下載——可以改成「自動縮小文字」，或${otherWays}`
            : `就算切成多張也放不下：同一個時間點的事件單獨一張都放不下（${whole.lost}），這個比例不能下載——可以改成「自動縮小文字」、調小文字大小${horizontal ? '、勾選「精簡模式」' : ''}，或${otherWays}`,
      })
    }
    const n = plan.pages.length
    const drawn: Drawn[] = []
    for (const [i, domain] of plan.pages.entries()) {
      drawn.push(await renderWith(theme, { domain, label: `第 ${i + 1}／${n} 張`, first: i === 0 }))
    }
    const lostAt = drawn.findIndex((d) => d.lost)
    return {
      pages: drawn.map(({ svg, w, h }) => ({ svg, w, h })),
      warnings: [...new Set(drawn.flatMap((d) => d.warnings))],
      info:
        n > 1
          ? `全部事件依時間先後分成 ${n} 張同樣比例的圖，每張的副標後面標有「第幾／共幾張」；下載時會一次下載 ${n} 個檔案`
          : undefined,
      blocked: lostAt >= 0 ? `第 ${lostAt + 1} 張還有事件放不下（${drawn[lostAt].lost}），不能下載` : undefined,
    }
  }

  /** 用指定的主題（字級）畫一次；lost = 有事件沒畫出來的原因 */
  const renderWith = async (theme: RenderTheme, page?: PageSpec): Promise<Drawn> => {
    // 切成多張時：這張只畫自己那一段，副標後面加頁碼，標註只放落在這一段的事件
    const pageCallouts = page
      ? calloutSpecs.filter((c) => {
          const u = splitBasis?.uOf.get(c.key)
          return u !== undefined && (page.first || u >= page.domain[0]) && u <= page.domain[1]
        })
      : calloutSpecs
    const sub = subtitleText
    const common = {
      sources,
      timeRange: page ? undefined : effectiveRange,
      domain: page?.domain,
      width: drawW,
      height: preset.h,
      showDates: true,
      showYears: true,
      dateParts: { year: dateYear, month: dateMonth, day: dateDay, time: dateTime },
      showRelations,
      collapseGaps,
      ordinal: useOrdinal,
      title: titleText,
      subtitle: page ? (sub ? `${sub} · ${page.label}` : page.label) : sub || undefined,
      footer: footerText,
      note: scopeNote,
      theme,
    }
    // 固定比例：照比例的高度畫一次；自動長度：先試算需要多高，再用那個高度畫
    const run = async <Req extends typeof common, Res extends { contentHeight: number }>(
      render: (req: Req) => Promise<Res>,
      req: Req,
      probeHeight: number,
    ): Promise<Res & { height: number }> =>
      auto ? renderWithAutoHeight(render, req, probeHeight) : { ...(await render(req)), height: preset.h }
    const warnings: string[] = []
    if (rangeKind === 'years' && !timeRange) warnings.push('自訂年份還沒填完整，暫時畫出全部時間')
    if (eventScope === 'featured' && scopeCounts.featured === 0) {
      warnings.push('這段時間、這些軸線沒有標示為關鍵事件（★）的事件，所以圖上沒有事件——請改選「所有事件」，或先在事件詳情卡把重點事件設為關鍵事件')
    }
    if (layout === 'B') {
      const n = sources.reduce((k, src) => k + src.doc.tracks.length, 0)
      if (n < 2) warnings.push('只有一條軸線，沒有東西可以對照——雙向對照版型需要兩條軸線，請多勾選一條軸線')
      else if (n > 2) {
        const top = Math.ceil(n / 2)
        warnings.push(
          `對照版型最適合兩條軸線；目前有 ${n} 條，前 ${top} 條放在${bDir === 'h' ? '上方' : '左側'}、其餘放在${bDir === 'h' ? '下方' : '右側'}`,
        )
      }
    }
    if (horizontal) {
      const { svg, overflow, clipped, height, calloutsDropped } = await run(
        renderHorizontalExportSvg,
        { ...common, compact, swimlane: true, centerAxis: layout === 'B', callouts: pageCallouts },
        // 試算畫布要夠長：標註框放不進軸線之間的空白時，才有地方往下放
        calloutSpecs.length > 0 ? 200_000 : 600,
      )
      warnDroppedCallouts(calloutsDropped, warnings)
      const lost = overflow
        ? '軸線與事件太多，超出畫面'
        : clipped > 0
          ? `${clipped} 件事件的標題放不下，只剩圓點`
          : undefined
      return { svg, warnings, w: drawW, h: height, lost }
    }
    if (layout === 'D' && cardMode) {
      const { svg, hidden, height } = await run(
        renderChronicleExportSvg,
        {
          ...common,
          reversed,
          showConfidence,
          showSources,
          // 跨過分界的長期事件只列在它開始的那張，卡片不重複
          onlyStartingInRange: page ? !page.first : false,
        },
        200_000,
      )
      const lost = hidden > 0 ? `還差 ${hidden} 件` : undefined
      return { svg, warnings, w: drawW, h: height, lost }
    }
    const vReq = {
      ...common,
      reversed,
      // 版型 B 的左右對照：刻度尺一定在中間、年份放大
      centerAxis: layout === 'B' || centerAxis,
      bigYears: layout === 'B',
      callouts: pageCallouts,
    }
    let v = await run(renderVerticalExportSvg, vReq, 600)
    // 自動長度要放得下全部事件：照時間比例排時，事件擠在同一段就只剩圓點——
    // 把圖再拉長重畫，直到每件都有標題（字放大的主題特別需要）
    // 拉長也沒有變少（例如好幾件同一天的事件擠在同一格）就停，不做出一張無謂的超長圖
    // （連續兩次拉長都沒有變少才停，保留最好的那次）
    // 勾了標註框卻放不下時也一樣：圖拉長，事件之間才有空白處放框
    // （先求每件事件都有標題，其次才是標註）
    const shortfall = (r: { hidden: number; calloutsDropped: string[] }) =>
      r.hidden * 1000 + r.calloutsDropped.length
    let tryH = v.height
    for (let stale = 0; auto && shortfall(v) > 0 && stale < 2 && tryH < AUTO_MAX_H; ) {
      tryH = Math.min(AUTO_MAX_H, Math.ceil(tryH * 1.35))
      const next = { ...(await renderVerticalExportSvg({ ...vReq, height: tryH })), height: tryH }
      if (shortfall(next) < shortfall(v)) {
        v = next
        stale = 0
      } else stale++
    }
    const { svg, hidden, narrowColumns, height, calloutsDropped } = v
    warnDroppedCallouts(calloutsDropped, warnings)
    if (narrowColumns) warnings.push('欄寬過窄，建議選更寬的比例，或取消勾選部分圖層／軸線')
    const lost = hidden > 0 ? `${hidden} 件只畫得出圓點、沒有標題` : undefined
    return { svg, warnings, w: drawW, h: height, lost }
  }

  /** 放不下而省略的標註：列出是哪幾個，不靜默拿掉 */
  function warnDroppedCallouts(dropped: string[], warnings: string[]) {
    if (dropped.length === 0) return
    const names = dropped.map((k) => calloutCandidates.find((c) => c.key === k)?.title ?? k)
    warnings.push(
      `有 ${dropped.length} 個標註放不下，已省略（${names.slice(0, 3).join('、')}${names.length > 3 ? '…' : ''}）——標註框不會蓋到事件文字，找不到空白處就省略；可以減少標註、縮短摘要、選較寬的比例或「自動長度」、改用版型 A，或該事件不在目前的時間範圍內`,
    )
  }

  // ---- 預覽：任何設定改變後 300 毫秒重畫 ----
  const [preview, setPreview] = useState<Rendered | null>(null)
  const [busy, setBusy] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const renderSeq = useRef(0)
  const settingsKey = JSON.stringify([
    layout, bDir, ratioId, themeId, fontScale, titleText, subtitleText, footerText, [...layerOn], [...trackOff],
    rangeKind, timeRange, viewDomain, dateYear, dateMonth, dateDay, dateTime, showRelations, collapseGaps, compact,
    reversed, centerAxis, cardMode, showConfidence, showSources, calloutKeys,
    eventScope, showScopeNote, overflowMode, ordinal,
    calloutText,
  ])
  // 設定一改，切出來的張數與內容都可能不同：預覽回到第 1 張
  useEffect(() => setPageIdx(0), [settingsKey])

  // 記住設定（存在這個瀏覽器）：圖層、軸線、標註換成文件 id，重新載入後才對得回來
  useEffect(() => {
    if (!initialized.current) return
    saveStudioSettings({
      v: 1,
      layout,
      bDir,
      ratioId,
      themeId,
      fontScale,
      overflowMode,
      title: customTitle,
      subtitle: customSubtitle,
      footer: customFooter,
      layerDocs: layerIdsToDocs(layerOn, layers),
      trackOffDocs: [...trackOff].flatMap((k) => toDocKey(k, layers) ?? []),
      rangeKind,
      fromYear,
      toYear,
      dateYear,
      dateMonth,
      dateDay,
      dateTime,
      showRelations,
      collapseGaps,
      ordinal,
      compact,
      reversed,
      centerAxis,
      embedFontsInSvg,
      cardMode,
      showConfidence,
      showSources,
      callouts: calloutKeys.flatMap((k) => toDocKey(k, layers) ?? []),
      calloutText: Object.fromEntries(
        Object.entries(calloutText).flatMap(([k, v]) => {
          const key = toDocKey(k, layers)
          return key ? [[key, v]] : []
        }),
      ),
      eventScope,
      showScopeNote,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsKey, customTitle, customSubtitle, customFooter, fromYear, toYear, embedFontsInSvg])
  useEffect(() => {
    if (!open) return
    const seq = ++renderSeq.current
    setBusy(true)
    const timer = window.setTimeout(() => {
      renderCurrent()
        .then((r) => {
          if (seq !== renderSeq.current) return
          setPreview(r)
          setPreviewError(null)
        })
        .catch((e: Error) => {
          if (seq === renderSeq.current) setPreviewError(e.message)
        })
        .finally(() => {
          if (seq === renderSeq.current) setBusy(false)
        })
    }, 300)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, settingsKey, layers])

  // ---- 下載與複製 ----
  // 下載與複製的結果：進行中（灰）、成功（綠）、失敗或改用別的方式（紅／黃），停留夠久讓人看得到
  type MessageTone = 'busy' | 'ok' | 'warn' | 'error'
  const [message, setMessage] = useState<{ text: string; tone: MessageTone } | null>(null)
  const msgTimer = useRef<number | undefined>(undefined)
  const say = (text: string, tone: MessageTone = 'busy', ms = tone === 'busy' ? 60_000 : 8000) => {
    setMessage({ text, tone })
    window.clearTimeout(msgTimer.current)
    msgTimer.current = window.setTimeout(() => setMessage(null), ms)
  }
  const fileBase = `hackstory-${auto ? 'auto' : preset.id}`

  /** 下載用：有事件放不下就不產生檔案 */
  const renderForExport = async () => {
    const r = await renderCurrent()
    if (r.blocked) throw new Error(r.blocked)
    return r
  }

  /** 切成多張時檔名帶頁碼：hackstory-16x9-1of3@2x.png */
  const pageFile = (i: number, n: number, ext: string) =>
    n > 1 ? `${fileBase}-${i + 1}of${n}${ext}` : `${fileBase}${ext}`
  /** 連續下載好幾個檔案時稍微隔一下，瀏覽器才不會吃掉 */
  const pause = () => new Promise((r) => window.setTimeout(r, 400))

  const makePng = async ({ svg, w, h }: Page, wanted: number) => {
    // 長圖超過瀏覽器畫布上限時降低倍率，寧可解析度低一點也要整張完整
    const scale = safePngScale(w, h, wanted)
    const png = await svgToPngWithFonts(svg, w, h, { scale, background: theme.colors.bg })
    const notes = [
      scale < wanted ? `圖太長，PNG 解析度自動降為 ${scale} 倍（要完整高解析度請下載 SVG）` : '',
      missingGlyphNote(png.missing),
    ].filter(Boolean)
    return { blob: png.blob, pixels: `${Math.round(w * scale)}×${Math.round(h * scale)}`, notes }
  }

  const downloadPng = (scale: number) => {
    say('正在嵌入字型、產生 PNG…')
    renderForExport()
      .then(async ({ pages }) => {
        const notes = new Set<string>()
        let pixels = ''
        for (const [i, page] of pages.entries()) {
          if (i > 0) await pause()
          const r = await makePng(page, scale)
          downloadBlob(pageFile(i, pages.length, `@${scale}x.png`), r.blob)
          r.notes.forEach((n) => notes.add(n))
          pixels = r.pixels
        }
        const what = pages.length > 1 ? `${pages.length} 張 PNG（每張 ${pixels}）` : `PNG（${pixels}）`
        say(`✓ 已下載 ${what}${[...notes].map((n) => '；' + n).join('')}`, 'ok')
      })
      .catch((e: Error) => say(`✕ 匯出失敗：${e.message}`, 'error'))
  }

  const downloadSvg = () => {
    say(embedFontsInSvg ? '正在嵌入字型…' : '正在產生 SVG…')
    renderForExport()
      .then(async ({ pages }) => {
        const notes = new Set<string>()
        for (const [i, { svg }] of pages.entries()) {
          if (i > 0) await pause()
          const fonts = embedFontsInSvg ? await embeddedFontCssForText(svg.textContent ?? '') : null
          const text = serializeSvg(svg, {
            background: theme.colors.bg,
            embeddedFontCss: fonts?.css,
          })
          downloadText(pageFile(i, pages.length, '.svg'), text, 'image/svg+xml')
          const note = fonts ? missingGlyphNote(fonts.missing) : ''
          if (note) notes.add(note)
        }
        const what = pages.length > 1 ? `${pages.length} 個 SVG` : 'SVG'
        say(`✓ 已下載 ${what}${[...notes].map((n) => '；' + n).join('')}`, 'ok')
      })
      .catch((e: Error) => say(`✕ 匯出失敗：${e.message}`, 'error'))
  }

  const copyToClipboard = () => {
    // 要在按下的當下就開始寫剪貼簿（Safari 的規定），圖片之後才做好也沒關係。
    // 切成多張時複製預覽正在看的那一張
    const png = renderForExport().then(async ({ pages }) => {
      const i = Math.min(pageIdx, pages.length - 1)
      return { ...(await makePng(pages[i], 2)), i, n: pages.length }
    })
    say('正在產生圖片並複製…')
    void copyPngToClipboard(png.then((r) => r.blob)).then(async (ok) => {
      if (ok) {
        const { notes, i, n } = await png
        const which = n > 1 ? `第 ${i + 1}／${n} 張` : '圖片'
        say(`✓ 已複製${which}到剪貼簿，可以直接貼進簡報或社群貼文${notes.map((x) => '；' + x).join('')}`, 'ok')
        return
      }
      // 瀏覽器不讓複製圖片：退回下載，並說清楚
      try {
        const { blob, i, n } = await png
        downloadBlob(pageFile(i, n, '@2x.png'), blob)
        say(`這個瀏覽器不讓網頁複製圖片，已改成下載 PNG（${n > 1 ? `第 ${i + 1}／${n} 張` : '圖片'}）`, 'warn')
      } catch (e) {
        say(`✕ 複製失敗：${(e as Error).message}`, 'error')
      }
    })
  }

  if (!open) return null

  // 標題、副標在圖上最多兩行：看實際畫出來的圖（可能自動縮過字）有沒有被截短，有就在輸入框下提醒
  const firstPage = preview?.pages[0]?.svg
  const headerFit = {
    titleTruncated: firstPage?.dataset.titleTruncated === '1',
    subtitleTruncated: firstPage?.dataset.subtitleTruncated === '1',
  }
  const blocked = Boolean(preview?.blocked)
  const pageCount = preview?.pages.length ?? 1
  const shownIdx = Math.min(pageIdx, pageCount - 1)
  const shown = preview?.pages[shownIdx]

  const pickRatio = (id: RatioChoice) => {
    setRatioId(id)
    // 自動長度不限方向，沿用目前的版型
    // 比例決定方向（原則 2）：長比例建議直式大事記、寬比例建議泳道；之後可以自己改
    // 版型 B 不換版型，改換方向（寬→上下對照、長→左右對照）
    const p = RATIO_PRESETS.find((r) => r.id === id)
    if (p && layout === 'B') setBDir(p.dir)
    else if (p) setLayout(p.dir === 'v' ? 'D' : 'A')
  }

  const toggle = (set: Set<string>, key: string, on: boolean) => {
    const next = new Set(set)
    if (on) next.add(key)
    else next.delete(key)
    return next
  }

  const pickRange = (kind: RangeKind) => {
    setRangeKind(kind)
    if (kind === 'years' && fullYears && !fromYear && !toYear) {
      setFromYear(String(fullYears[0]))
      setToYear(String(fullYears[1]))
    }
  }

  const checkbox = (label: string, checked: boolean, onChange: (v: boolean) => void, disabled = false) => (
    <label className={'flex items-center gap-2 text-base ' + (disabled ? 'text-ink-faint' : 'text-ink-muted')}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-accent"
      />
      {label}
    </label>
  )

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-surface">
      <header className="flex items-center gap-4 border-b border-line px-4 py-2">
        <h2 className="text-lg font-bold text-ink">出圖工作室</h2>
        <span className="text-sm text-ink-faint">預覽就是下載下來的樣子</span>
        <button
          type="button"
          onClick={resetAll}
          title="工作室會記住你上次的設定；按這裡全部回到預設"
          className="btn ml-auto"
        >
          恢復預設設定
        </button>
        <button type="button" onClick={onClose} className="btn">
          關閉（Esc）
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 左：即時預覽 */}
        <div className="min-w-0 flex-[7] bg-surface-alt p-4">
          <StudioPreview
            svg={shown?.svg ?? null}
            width={shown?.w ?? drawW}
            height={shown?.h ?? preset.h}
            pageIndex={shownIdx}
            pageCount={pageCount}
            onPage={setPageIdx}
            onSplit={!auto && overflowMode === 'shrink' ? () => setOverflowMode('split') : undefined}
            background={theme.colors.bg}
            busy={busy}
            warnings={preview?.warnings ?? []}
            info={preview?.info}
            blocked={preview?.blocked}
            error={previewError}
          />
        </div>

        {/* 右：設定 */}
        <aside className="flex min-w-[320px] flex-[3] flex-col border-l border-line">
          <div className="flex-1 space-y-5 overflow-y-auto p-4">
            <Section title="版型">
              <div className="grid grid-cols-2 gap-2">
                {LAYOUTS.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    disabled={!l.ready}
                    title={l.hint}
                    onClick={() => {
                      setLayout(l.id)
                      // 換成版型 B 時，方向跟著目前的比例（自動長度就沿用上次的方向）；
                      // 對照看的是兩邊的互動，關係線預設打開
                      if (l.id === 'B') {
                        if (!auto) setBDir(preset.dir)
                        setShowRelations(true)
                      }
                    }}
                    className={
                      'rounded border px-2 py-1.5 text-left transition-colors ' +
                      (layout === l.id
                        ? 'border-accent bg-accent text-white'
                        : 'border-line text-ink hover:bg-surface-alt') +
                      (l.ready ? '' : ' cursor-not-allowed opacity-50')
                    }
                  >
                    <span className="block text-base font-medium">{l.label}</span>
                    <span className={'block text-sm ' + (layout === l.id ? 'text-white/80' : 'text-ink-faint')}>
                      {l.ready ? l.hint : '即將推出'}
                    </span>
                  </button>
                ))}
              </div>
              {layout === 'B' && (
                <div className="mt-3 space-y-1">
                  <p className="text-sm text-ink-faint">對照方向（事件依軸線分到兩側，中間是共用的時間軸）</p>
                  {(
                    [
                      ['h', '上下對照（橫式）'],
                      ['v', '左右對照（直式）'],
                    ] as const
                  ).map(([dir, label]) => (
                    <label key={dir} className="flex items-center gap-2 text-base text-ink-muted">
                      <input
                        type="radio"
                        name="studio-bdir"
                        checked={bDir === dir}
                        onChange={() => setBDir(dir)}
                        className="accent-accent"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              )}
            </Section>

            <Section title="比例" note="選比例會自動建議方向：長的用直式、寬的用橫式（版型 B 切換上下／左右對照），可以再改">
              <button
                type="button"
                onClick={() => pickRatio('auto')}
                className={
                  'mb-2 w-full rounded border px-2.5 py-1.5 text-left transition-colors ' +
                  (auto ? 'border-accent bg-accent text-white' : 'border-line text-ink hover:bg-surface-alt')
                }
              >
                <span className="text-base font-medium">自動長度</span>
                <span className={'ml-1.5 text-sm ' + (auto ? 'text-white/80' : 'text-ink-faint')}>
                  寬度固定、高度拉長到所有軸線與事件都放得下
                </span>
              </button>
              {(['h', 'v'] as const).map((dir) => (
                <div key={dir} className="mb-2">
                  <p className="mb-1 text-sm text-ink-faint">{dir === 'h' ? '橫式（簡報）' : '直式（手機／社群／列印）'}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {RATIO_PRESETS.filter((p) => p.dir === dir).map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        title={p.hint}
                        onClick={() => pickRatio(p.id)}
                        className={
                          'rounded border px-2.5 py-1 text-base transition-colors ' +
                          (ratioId === p.id
                            ? 'border-accent bg-accent text-white'
                            : 'border-line text-ink hover:bg-surface-alt')
                        }
                      >
                        {p.label}
                        <span className={'ml-1 text-sm ' + (ratioId === p.id ? 'text-white/70' : 'text-ink-faint')}>
                          {p.hint}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {!auto && (
                <div className="mt-3 space-y-1">
                  <p className="text-sm text-ink-faint">放不下全部事件時</p>
                  {(
                    [
                      ['shrink', `自動縮小文字（最小到 ${Math.round(MIN_FIT_SCALE * 100)}%）`],
                      ['split', '切分成多張圖（同樣比例、文字不縮小）'],
                    ] as const
                  ).map(([mode, label]) => (
                    <label key={mode} className="flex items-center gap-2 text-base text-ink-muted">
                      <input
                        type="radio"
                        name="studio-overflow"
                        checked={overflowMode === mode}
                        onChange={() => setOverflowMode(mode)}
                        className="accent-accent"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              )}
            </Section>

            <Section title="主題">
              <select
                value={themeId}
                onChange={(e) => setThemeId(e.target.value as ThemeId)}
                className="field w-full"
              >
                {THEME_OPTIONS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
              <label className="mt-2 flex items-center gap-2 text-base text-ink-muted">
                字級
                <input
                  type="range"
                  min={0.8}
                  max={1.6}
                  step={0.1}
                  value={fontScale}
                  onChange={(e) => setFontScale(Number(e.target.value))}
                  className="flex-1 accent-accent"
                />
                <span className="w-12 text-right tabular-nums">{Math.round(fontScale * 100)}%</span>
              </label>
            </Section>

            <Section title="標題區">
              <Field label="標題">
                <input
                  value={customTitle ?? autoTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  className="field w-full"
                />
                {headerFit.titleTruncated && (
                  <p className="mt-1 text-sm text-warn">標題太長：圖上最多放兩行，超過的部分會變成「…」，建議縮短</p>
                )}
              </Field>
              <Field label="副標（可留空）">
                <input
                  value={customSubtitle ?? autoSubtitle}
                  onChange={(e) => setCustomSubtitle(e.target.value)}
                  className="field w-full"
                />
                {headerFit.subtitleTruncated && (
                  <p className="mt-1 text-sm text-warn">副標太長：圖上最多放兩行，超過的部分會變成「…」，建議縮短</p>
                )}
              </Field>
              <Field label="出處行（固定在圖片底部，不可省略）">
                <input
                  value={customFooter ?? autoFooter}
                  onChange={(e) => setCustomFooter(e.target.value)}
                  placeholder={autoFooter}
                  className="field w-full"
                />
              </Field>
            </Section>

            <Section title="內容">
              <button type="button" onClick={matchScreen} className="btn mb-3 w-full text-sm">
                跟主畫面一樣（圖層、軸線、時間範圍、事件）
              </button>

              <p className="mb-1 text-sm text-ink-faint">呈現哪些事件</p>
              <div className="mb-3 space-y-1.5">
                {(
                  [
                    ['all', '所有事件'],
                    ['featured', '只放關鍵事件（★）'],
                  ] as const
                ).map(([scope, label]) => (
                  <label key={scope} className="flex items-center gap-2 text-base text-ink-muted">
                    <input
                      type="radio"
                      name="studio-scope"
                      checked={eventScope === scope}
                      onChange={() => setEventScope(scope)}
                      className="accent-accent"
                    />
                    {label}
                    {scope === 'featured' && (
                      <span className="text-sm text-ink-faint">
                        （{scopeCounts.total} 件中的 {scopeCounts.featured} 件）
                      </span>
                    )}
                  </label>
                ))}
                {eventScope === 'featured' && (
                  <div className="ml-6">
                    {checkbox('圖上註明「僅列關鍵事件（N 件中的 M 件）」', showScopeNote, setShowScopeNote)}
                  </div>
                )}
              </div>

              <p className="mb-1 text-sm text-ink-faint">要放哪些圖層與軸線</p>
              <div className="mb-3 space-y-1.5">
                {layers.map((l) => (
                  <div key={l.id}>
                    {checkbox(l.doc.meta.title, layerOn.has(l.id), (v) => setLayerOn(toggle(layerOn, l.id, v)))}
                    {l.doc.tracks.length > 1 && (
                      <div className="ml-6 mt-1 space-y-1">
                        {l.doc.tracks.map((t) =>
                          <div key={t.id}>
                            {checkbox(
                              t.title,
                              !trackOff.has(`${l.id}/${t.id}`),
                              (v) => setTrackOff(toggle(trackOff, `${l.id}/${t.id}`, !v)),
                              !layerOn.has(l.id),
                            )}
                          </div>,
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <p className="mb-1 text-sm text-ink-faint">時間範圍</p>
              <div className="mb-3 space-y-1.5">
                {(
                  [
                    ['view', '目前畫面看到的那一段'],
                    ['all', '全部'],
                    ['years', '自訂年份'],
                  ] as const
                ).map(([kind, label]) => (
                  <label key={kind} className="flex items-center gap-2 text-base text-ink-muted">
                    <input
                      type="radio"
                      name="studio-range"
                      checked={rangeKind === kind}
                      disabled={kind === 'view' && !viewDomain}
                      onChange={() => pickRange(kind)}
                      className="accent-accent"
                    />
                    {label}
                  </label>
                ))}
                {rangeKind === 'years' && (
                  <div className="ml-6 flex items-center gap-2 text-base text-ink-muted">
                    <input
                      value={fromYear}
                      onChange={(e) => setFromYear(e.target.value)}
                      inputMode="numeric"
                      className="field w-24"
                    />
                    年到
                    <input
                      value={toYear}
                      onChange={(e) => setToYear(e.target.value)}
                      inputMode="numeric"
                      className="field w-24"
                    />
                    年
                  </div>
                )}
              </div>

              <p className="mb-1 text-sm text-ink-faint">顯示</p>
              <div className="space-y-1.5">
                {layout === 'D' && (
                  <>
                    {checkbox('卡片模式（標題＋摘要）', cardMode, setCardMode)}
                    <p className="ml-6 text-sm text-ink-faint">
                      {cardMode
                        ? '卡片依先後排列，間距不代表時間長短（圖上會註明）；不畫關係線'
                        : '照時間比例排的直式長圖'}
                    </p>
                  </>
                )}
                {/* 日期：年、月、日、時間各自勾選；勾「日」時一併帶入「月」。時間只影響精確到分鐘的事件 */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-base text-ink-muted">
                  <span>日期</span>
                  {checkbox('年', dateYear, setDateYear)}
                  {checkbox('月', dateMonth, setDateMonth)}
                  {checkbox('日', dateDay, (v) => {
                    setDateDay(v)
                    if (v) setDateMonth(true)
                  })}
                  {checkbox('時間', dateTime, (v) => {
                    setDateTime(v)
                    // 時間要跟著日期才有意義：勾時間就一併帶入月、日
                    if (v) {
                      setDateDay(true)
                      setDateMonth(true)
                    }
                  })}
                </div>
                {layout === 'D' && cardMode ? (
                  <>
                    {checkbox('顯示查證程度（已查證／據報導／有爭議）', showConfidence, setShowConfidence)}
                    {checkbox('列出資料來源（出處）', showSources, setShowSources)}
                    {checkbox('最新的在上面', reversed, setReversed)}
                  </>
                ) : (
                  <>
                    {checkbox('關係線', showRelations, setShowRelations)}
                    {checkbox('順序等距', ordinal, setOrdinal)}
                    <p className="-mt-1 ml-6 text-sm text-ink-faint">
                      事件之間不照時間比例、依先後平均排開，適合少量精選事件；圖上會固定標示「非等比」
                    </p>
                    {checkbox(ordinal ? '摺疊空白（順序等距時不需要）' : '摺疊空白', collapseGaps, setCollapseGaps, ordinal)}
                    {horizontal && checkbox('精簡模式（塞進更多軸線）', compact, setCompact)}
                    {!horizontal && checkbox('最新的在上面', reversed, setReversed)}
                    {layout === 'D' && checkbox('刻度置中對照', centerAxis, setCenterAxis)}
                  </>
                )}
              </div>
              {/* 標註事件：放在「內容」的最後 */}
              <div className="mt-4 border-t border-line pt-3">
              <p className="mb-1 text-base font-bold text-ink">
                標註事件（{calloutKeys.length}／{MAX_CALLOUTS}）
              </p>
              <p className="mb-2 text-sm text-ink-faint">
                勾選的事件會加上「標題＋一句摘要」的說明框，用引線連回事件。關鍵事件（★）排在前面
              </p>
              {!(layout === 'D' && cardMode) && (
                <button
                  type="button"
                  disabled={calloutKeys.length === 0}
                  onClick={() => setCalloutKeys([])}
                  className="btn mb-2 w-full text-sm"
                >
                  全部取消勾選
                </button>
              )}
              {layout === 'D' && cardMode ? (
                <p className="text-sm text-ink-faint">
                  卡片模式每張卡片已有標題與摘要，不另加標註框。取消「卡片模式」即可使用。
                </p>
              ) : (
                <div className="max-h-80 space-y-3 overflow-y-auto rounded border border-line p-2">
                  {calloutCandidates.length === 0 && (
                    <p className="text-sm text-ink-faint">沒有可標註的事件</p>
                  )}
                  {calloutGroups.map((g) => {
                    const picked = g.items.filter((c) => calloutKeys.includes(c.key)).length
                    return (
                      <div key={g.key} className="space-y-1.5">
                        {/* 軸線小標題：與圖上同一個顏色 */}
                        <div className="sticky top-0 -mx-2 flex items-center gap-2 bg-surface px-2 py-1 text-sm font-bold text-ink">
                          <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: g.color }} />
                          <span className="min-w-0 flex-1 truncate">{g.label}</span>
                          <span className="shrink-0 font-normal text-ink-faint">
                            {picked > 0 ? `已選 ${picked}` : `${g.items.length} 件`}
                          </span>
                        </div>
                        {g.items.map((c) => {
                          const on = calloutKeys.includes(c.key)
                          const full = !on && calloutKeys.length >= MAX_CALLOUTS
                          return (
                            <div key={c.key}>
                              <label
                                className={'flex items-start gap-2 text-base ' + (full ? 'text-ink-faint' : 'text-ink-muted')}
                                title={full ? `最多 ${MAX_CALLOUTS} 個，請先取消其他標註` : undefined}
                              >
                                <input
                                  type="checkbox"
                                  checked={on}
                                  disabled={full}
                                  onChange={(e) =>
                                    setCalloutKeys((prev) =>
                                      e.target.checked ? [...prev, c.key] : prev.filter((k) => k !== c.key),
                                    )
                                  }
                                  className="mt-1 accent-accent"
                                />
                                <span>
                                  {c.featured && <span className="mr-1 text-warn">★</span>}
                                  {c.title}
                                </span>
                              </label>
                              {on &&
                                (() => {
                                  const text = calloutText[c.key] ?? defaultSummary(c.description, summaryCap)
                                  const used = summaryUsed(text)
                                  return (
                                    <>
                                      <input
                                        value={text}
                                        onChange={(e) => setCalloutText((prev) => ({ ...prev, [c.key]: e.target.value }))}
                                        placeholder="一句摘要（可留空，只顯示標題）"
                                        className="field ml-6 mt-1 w-[calc(100%-1.5rem)]"
                                      />
                                      <p
                                        className={
                                          'ml-6 text-sm ' + (used > summaryCap ? 'text-warn' : 'text-ink-faint')
                                        }
                                      >
                                        約 {used}／{summaryCap} 字
                                        {used > summaryCap && '——框裡放不下，超過的部分會變成「…」，建議縮短'}
                                      </p>
                                    </>
                                  )
                                })()}
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              )}
              </div>
            </Section>
          </div>

          {/* 底部：下載與複製 */}
          <div className="space-y-2 border-t border-line bg-surface p-4">
            {message && (
              <p
                role="status"
                className={
                  'rounded border px-2 py-1.5 text-sm ' +
                  (message.tone === 'ok'
                    ? 'border-green-300 bg-green-50 text-green-800'
                    : message.tone === 'error'
                      ? 'border-red-300 bg-red-50 text-red-800'
                      : message.tone === 'warn'
                        ? 'border-amber-300 bg-amber-50 text-amber-800'
                        : 'border-line bg-surface-alt text-ink-muted')
                }
              >
                {message.text}
              </p>
            )}
            {blocked && <p className="text-sm text-danger">有事件放不下，這個比例不能下載（原因見預覽上方）</p>}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => downloadPng(2)} className="btn btn-primary" disabled={blocked}>
                下載 PNG（2×）
              </button>
              <button type="button" onClick={() => downloadPng(3)} className="btn" disabled={blocked}>
                下載 PNG（3×）
              </button>
              <button type="button" onClick={downloadSvg} className="btn" disabled={blocked}>
                下載 SVG
              </button>
              <button type="button" onClick={copyToClipboard} className="btn" disabled={blocked}>
                複製到剪貼簿
              </button>
            </div>
            <label
              className="flex items-start gap-2 text-sm text-ink-muted"
              title="開啟後檔案會大好幾 MB，但在沒裝思源黑體的電腦也能正確顯示"
            >
              <input
                type="checkbox"
                checked={embedFontsInSvg}
                onChange={(e) => setEmbedFontsInSvg(e.target.checked)}
                className="mt-0.5 accent-accent"
              />
              SVG 嵌入字型（檔案會大好幾 MB，但在沒裝思源黑體的電腦也能正確顯示）
            </label>
          </div>
        </aside>
      </div>
    </div>
  )
}

/** 預設出處行：作者 · 授權 · 今天日期（由文件的 meta 組成） */
function defaultFooter(layers: Layer[]): string {
  const metas = layers.map((l) => l.doc.meta)
  const authors = [...new Set(metas.flatMap((m) => (m.authors ?? []).map((a) => a.name)))]
  const licenses = [...new Set(metas.map((m) => m.license).filter(Boolean))]
  return [
    authors.length > 0 ? authors.slice(0, 3).join('、') + (authors.length > 3 ? ' 等' : '') : null,
    licenses.length > 0 ? licenses.join('／') : null,
    todayText(),
    '以 HackStory 製作',
  ]
    .filter(Boolean)
    .join(' · ')
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-base font-bold text-ink">{title}</h3>
      {note && <p className="mb-2 text-sm text-ink-faint">{note}</p>}
      {children}
    </section>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mb-2 block">
      <span className="mb-1 block text-sm text-ink-faint">{label}</span>
      {children}
    </label>
  )
}
