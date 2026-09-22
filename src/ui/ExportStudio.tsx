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
import { sourcesFor } from '../compose/useLayers'
import {
  renderChronicleExportSvg,
  renderHorizontalExportSvg,
  renderVerticalExportSvg,
  renderWithAutoHeight,
} from '../render/exportSvg'
import type { ThemeId } from '../render/theme'
import { deriveTheme, THEMES } from '../render/theme'
import { buildTimelineBase } from '../render/timelineData'
import type { RatioId } from './ratios'
import { RATIO_PRESETS } from './ratios'
import { StudioPreview } from './StudioPreview'

/** 四種版型（見 docs/ui-upgrade-plan.md 第 0.7 節） */
type LayoutId = 'A' | 'D' | 'B' | 'C'
const LAYOUTS: Array<{ id: LayoutId; label: string; hint: string; ready: boolean }> = [
  { id: 'A', label: 'A 多軸泳道', hint: '跨主體的橫向交互作用', ready: true },
  { id: 'D', label: 'D 直式大事記', hint: '深度證據鏈與脈絡錨定', ready: true },
  { id: 'B', label: 'B 雙向對照', hint: '二元對抗與矛盾檢驗', ready: false },
  { id: 'C', label: 'C 因果魚骨', hint: '多重因果匯聚', ready: false },
]

const THEME_OPTIONS: Array<{ id: ThemeId; label: string }> = [
  { id: 'presentation', label: '簡報（淺底）' },
  { id: 'presentation-dark', label: '簡報（深底）' },
  { id: 'screen', label: '螢幕' },
  { id: 'print', label: '列印' },
]

type RangeKind = 'view' | 'all' | 'years'

/** 比例：十種固定比例，或「自動長度」（寬度固定、高度拉長到全部放得下） */
type RatioChoice = RatioId | 'auto'
/** 自動長度的寬度：泳道沿用 16:9 的寬、直式沿用 A4 的寬 */
const AUTO_WIDTH = { horizontal: 960, vertical: 620 }

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
  const [layout, setLayout] = useState<LayoutId>(orientation === 'vertical' ? 'D' : 'A')
  const [ratioId, setRatioId] = useState<RatioChoice>(orientation === 'vertical' ? 'a4' : '16-9')
  const [themeId, setThemeId] = useState<ThemeId>('presentation')
  const [fontScale, setFontScale] = useState(1)
  const [title, setTitle] = useState('')
  const [subtitle, setSubtitle] = useState('')
  const [footer, setFooter] = useState('')
  const [layerOn, setLayerOn] = useState<Set<string>>(new Set())
  const [trackOff, setTrackOff] = useState<Set<string>>(new Set())
  const [rangeKind, setRangeKind] = useState<RangeKind>('view')
  const [fromYear, setFromYear] = useState('')
  const [toYear, setToYear] = useState('')
  const [showDates, setShowDates] = useState(props.showDates)
  const [showYears, setShowYears] = useState(props.showYears)
  const [showRelations, setShowRelations] = useState(props.showRelations)
  const [collapseGaps, setCollapseGaps] = useState(props.collapseGaps)
  const [compact, setCompact] = useState(props.compact)
  const [reversed, setReversed] = useState(props.reversed)
  const [centerAxis, setCenterAxis] = useState(props.centerAxis)
  const [embedFontsInSvg, setEmbedFontsInSvg] = useState(false)
  // 版型 D：卡片大事記（依先後排列）或照時間比例的直式長圖
  const [cardMode, setCardMode] = useState(true)
  // 卡片上要寫哪些小字，以及圖上要不要註明「另有 N 件未列出」
  const [showConfidence, setShowConfidence] = useState(true)
  const [showSources, setShowSources] = useState(true)
  const [showHiddenNote, setShowHiddenNote] = useState(true)

  // 每次打開工作室：預設值跟「目前畫面」一樣，標題、出處從文件資料帶入
  useEffect(() => {
    if (!open) return
    const visible = layers.filter((l) => l.visible)
    const first = visible[0]?.doc.meta
    setLayerOn(new Set(visible.map((l) => l.id)))
    setTrackOff(new Set(hiddenTracks))
    setTitle(
      visible.length === 1
        ? visible[0].doc.meta.title
        : visible.length > 1
          ? `${visible[0].doc.meta.title} 等 ${visible.length} 份`
          : 'HackStory',
    )
    setSubtitle(first?.subtitle ?? '')
    setFooter(defaultFooter(visible))
    setShowDates(props.showDates)
    setShowYears(props.showYears)
    setShowRelations(props.showRelations)
    setCollapseGaps(props.collapseGaps)
    setCompact(props.compact)
    setReversed(props.reversed)
    setCenterAxis(props.centerAxis)
    setRangeKind(viewDomain ? 'view' : 'all')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

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
  const drawW = auto ? (layout === 'A' ? AUTO_WIDTH.horizontal : AUTO_WIDTH.vertical) : preset.w
  const theme = useMemo(
    () => deriveTheme(THEMES[themeId], { scale: THEMES[themeId].scale * fontScale }),
    [themeId, fontScale],
  )
  const sources = useMemo(
    () => sourcesFor(layers, (l) => layerOn.has(l.id), trackOff),
    [layers, layerOn, trackOff],
  )

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

  // 出處行不可關閉（誠實與可信原則）：清空了就退回預設
  const footerText = footer.trim() || defaultFooter(layers.filter((l) => layerOn.has(l.id)))

  // ---- 產生圖片（預覽與下載共用同一份設定） ----
  type Rendered = { svg: SVGSVGElement; warnings: string[]; w: number; h: number }
  const renderCurrent = async (): Promise<Rendered> => {
    if (sources.length === 0) throw new Error('沒有勾選任何圖層或軸線')
    const common = {
      sources,
      domain: rangeKind === 'view' && viewDomain ? viewDomain : undefined,
      timeRange,
      width: drawW,
      height: preset.h,
      showDates,
      showYears,
      showRelations,
      collapseGaps,
      title: title.trim() || 'HackStory',
      subtitle: subtitle.trim() || undefined,
      footer: footerText,
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
    if (layout === 'A') {
      const { svg, overflow, height } = await run(
        renderHorizontalExportSvg,
        { ...common, compact, swimlane: true },
        600,
      )
      if (overflow) {
        warnings.push(
          '軸線太多，超出這個比例的部分被裁掉了——可以勾選「精簡模式」、取消勾選部分圖層／軸線，或改用「自動長度」',
        )
      }
      return { svg, warnings, w: drawW, h: height }
    }
    if (cardMode) {
      const { svg, hidden, height } = await run(
        renderChronicleExportSvg,
        { ...common, reversed, showConfidence, showSources, showHiddenNote },
        200_000,
      )
      if (hidden > 0) {
        warnings.push(
          `還有 ${hidden} 件事件放不下${showHiddenNote ? `（圖上會註明「另有 ${hidden} 件未列出」）` : '（圖上不會註明，看圖的人不會知道有省略）'}——請縮短時間範圍、取消勾選部分軸線，或選「自動長度」`,
        )
      }
      return { svg, warnings, w: drawW, h: height }
    }
    const { svg, hidden, narrowColumns, height } = await run(
      renderVerticalExportSvg,
      { ...common, reversed, centerAxis },
      600,
    )
    if (narrowColumns) warnings.push('欄寬過窄，建議選更寬的比例，或取消勾選部分圖層／軸線')
    if (hidden > 0) {
      warnings.push(
        `這段時間的事件太多，有 ${hidden} 件只畫得出圓點、放不下標題——請縮短時間範圍，或選「自動長度」`,
      )
    }
    return { svg, warnings, w: drawW, h: height }
  }

  // ---- 預覽：任何設定改變後 300 毫秒重畫 ----
  const [preview, setPreview] = useState<Rendered | null>(null)
  const [busy, setBusy] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const renderSeq = useRef(0)
  const settingsKey = JSON.stringify([
    layout, ratioId, themeId, fontScale, title, subtitle, footerText, [...layerOn], [...trackOff],
    rangeKind, timeRange, viewDomain, showDates, showYears, showRelations, collapseGaps, compact,
    reversed, centerAxis, cardMode, showConfidence, showSources, showHiddenNote,
  ])
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
  const [message, setMessage] = useState<string | null>(null)
  const msgTimer = useRef<number | undefined>(undefined)
  const say = (msg: string, ms = 3500) => {
    setMessage(msg)
    window.clearTimeout(msgTimer.current)
    msgTimer.current = window.setTimeout(() => setMessage(null), ms)
  }
  const fileBase = `hackstory-${auto ? 'auto' : preset.id}`

  const makePng = async (wanted: number) => {
    const { svg, w, h } = await renderCurrent()
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
    say('正在嵌入字型、產生 PNG…', 20_000)
    makePng(scale)
      .then(({ blob, pixels, notes }) => {
        downloadBlob(`${fileBase}@${scale}x.png`, blob)
        say(`已下載 PNG（${pixels}）${notes.map((n) => '；' + n).join('')}`, notes.length ? 8000 : 3500)
      })
      .catch((e: Error) => say(`匯出失敗：${e.message}`))
  }

  const downloadSvg = () => {
    say(embedFontsInSvg ? '正在嵌入字型…' : '正在產生 SVG…', 20_000)
    renderCurrent()
      .then(async ({ svg }) => {
        const fonts = embedFontsInSvg ? await embeddedFontCssForText(svg.textContent ?? '') : null
        const text = serializeSvg(svg, {
          background: theme.colors.bg,
          embeddedFontCss: fonts?.css,
        })
        downloadText(`${fileBase}.svg`, text, 'image/svg+xml')
        const note = fonts ? missingGlyphNote(fonts.missing) : ''
        say(`已下載 SVG${note ? '；' + note : ''}`, note ? 8000 : 3500)
      })
      .catch((e: Error) => say(`匯出失敗：${e.message}`))
  }

  const copyToClipboard = () => {
    // 要在按下的當下就開始寫剪貼簿（Safari 的規定），圖片之後才做好也沒關係
    const png = makePng(2)
    say('正在產生圖片並複製…', 20_000)
    void copyPngToClipboard(png.then((r) => r.blob)).then(async (ok) => {
      if (ok) {
        const { notes } = await png
        say(`已複製圖片，可以直接貼進簡報${notes.map((n) => '；' + n).join('')}`, notes.length ? 8000 : 3500)
        return
      }
      // 瀏覽器不讓複製圖片：退回下載，並說清楚
      try {
        const { blob } = await png
        downloadBlob(`${fileBase}@2x.png`, blob)
        say('這個瀏覽器不讓網頁複製圖片，已改成下載 PNG', 6000)
      } catch (e) {
        say(`匯出失敗：${(e as Error).message}`)
      }
    })
  }

  if (!open) return null

  const pickRatio = (id: RatioChoice) => {
    setRatioId(id)
    // 自動長度不限方向，沿用目前的版型
    // 比例決定方向（原則 2）：長比例建議直式大事記、寬比例建議泳道；之後可以自己改
    const p = RATIO_PRESETS.find((r) => r.id === id)
    if (p) setLayout(p.dir === 'v' ? 'D' : 'A')
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
        <button type="button" onClick={onClose} className="btn ml-auto">
          關閉（Esc）
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 左：即時預覽 */}
        <div className="min-w-0 flex-[7] bg-surface-alt p-4">
          <StudioPreview
            svg={preview?.svg ?? null}
            width={preview?.w ?? drawW}
            height={preview?.h ?? preset.h}
            background={theme.colors.bg}
            busy={busy}
            warnings={preview?.warnings ?? []}
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
                    onClick={() => setLayout(l.id)}
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
            </Section>

            <Section title="比例" note="選比例會自動建議版型：長的用直式大事記、寬的用泳道，可以再改">
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
                <input value={title} onChange={(e) => setTitle(e.target.value)} className="field w-full" />
              </Field>
              <Field label="副標（可留空）">
                <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} className="field w-full" />
              </Field>
              <Field label="出處行（固定在圖片底部，不可省略）">
                <input
                  value={footer}
                  onChange={(e) => setFooter(e.target.value)}
                  placeholder={defaultFooter(layers.filter((l) => layerOn.has(l.id)))}
                  className="field w-full"
                />
              </Field>
            </Section>

            <Section title="內容">
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
                    {checkbox('卡片模式（標題＋摘要＋來源）', cardMode, setCardMode)}
                    <p className="ml-6 text-sm text-ink-faint">
                      {cardMode
                        ? '卡片依先後排列，間距不代表時間長短（圖上會註明）；不畫關係線'
                        : '照時間比例排的直式長圖'}
                    </p>
                  </>
                )}
                {layout === 'D' && cardMode ? (
                  <>
                    {checkbox('顯示查證程度（已查證／據報導／有爭議）', showConfidence, setShowConfidence)}
                    {checkbox('列出來源', showSources, setShowSources)}
                    {checkbox('放不下時在圖上註明「另有 N 件未列出」', showHiddenNote, setShowHiddenNote)}
                    {checkbox('最新的在上面', reversed, setReversed)}
                  </>
                ) : (
                  <>
                    {checkbox('事件日期', showDates, setShowDates)}
                    {checkbox('日期含年份', showYears, setShowYears, !showDates)}
                    {checkbox('關係線', showRelations, setShowRelations)}
                    {checkbox('摺疊空白', collapseGaps, setCollapseGaps)}
                    {layout === 'A' && checkbox('精簡模式（塞進更多軸線）', compact, setCompact)}
                    {layout === 'D' && checkbox('最新的在上面', reversed, setReversed)}
                    {layout === 'D' && checkbox('刻度置中對照', centerAxis, setCenterAxis)}
                  </>
                )}
              </div>
            </Section>
          </div>

          {/* 底部：下載與複製 */}
          <div className="space-y-2 border-t border-line bg-surface p-4">
            {message && <p className="text-sm text-ink-muted">{message}</p>}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => downloadPng(2)} className="btn btn-primary">
                下載 PNG（2×）
              </button>
              <button type="button" onClick={() => downloadPng(3)} className="btn">
                下載 PNG（3×）
              </button>
              <button type="button" onClick={downloadSvg} className="btn">
                下載 SVG
              </button>
              <button type="button" onClick={copyToClipboard} className="btn">
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
