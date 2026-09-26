// render 層：時間軸視覺化引擎
// 自己用 SVG 畫（專案禁令：不引入 vis.js 等任何現成時間軸函式庫）。
// 這一層只認得 core 的資料模型，不知道資料是從 CSV、JSON 還是別的地方來的，
// 也不知道「圖層」怎麼管理——它只負責把收到的多份文件畫出來。

import { useEffect, useMemo, useRef, useState } from 'react'
import { sameDocumentRelations } from '../core'
import { ExportFooter, exportFooterHeight } from './ExportFooter'
import { ExportHeader, layoutExportHeader } from './ExportHeader'
import { formatSkipped } from './gaps'
import { OrdinalBadge, ordinalBadgeWidth } from './OrdinalBadge'
import { layoutPeriods, periodSources } from './periods'
import { ordinalTicks, ORDINAL_STEP } from './ordinal'
import type { CalloutSpec } from './callouts'
import { placeCallouts } from './callouts'
import { CalloutLayer, calloutMetrics } from './CalloutLayer'
import { assignLanes, estimateTextWidth, wrapLines } from './layout'
import { fitText } from './verticalLayout'
import { buildBands, buildTimelineBase, RELATION_LABELS } from './timelineData'
import type { RenderTheme } from './theme'
import { deriveTheme, textOnColor, THEMES } from './theme'
import type { DateParts } from './timeScale'
import { formatRangeLabel, formatTick, getTicks } from './timeScale'
import type {
  EventSelection,
  NewEventDraft,
  ScaleMode,
  ScaleRequest,
  TimelineSource,
} from './types'

// 這些型別已搬到 ./types 供橫式與直式共用；這裡繼續 re-export，
// ui 層原本 `from '../render/TimelineView'` 的寫法不必更動。
export type {
  ScaleMode,
  ScaleRequest,
  TimelineSource,
  EventSelection,
  NewEventDraft,
} from './types'

interface Props {
  sources: TimelineSource[]
  scaleRequest?: ScaleRequest | null
  /** 縮放後回報目前落在哪個尺度，讓 ui 層的按鈕高亮 */
  onScaleModeChange?: (mode: ScaleMode) => void
  /** 是否在事件標題前顯示日期（預設顯示） */
  showDates?: boolean
  /** 日期是否含年份（整條軸都在同一年時可關掉，預設顯示） */
  showYears?: boolean
  /** 年、月、日分別控制（出圖用）；有給就取代上面兩個勾選 */
  dateParts?: DateParts
  /** 是否繪製事件關係線（SPEC 第 7 節 relations，預設顯示） */
  showRelations?: boolean
  /** 是否摺疊大段空白（SPEC display.collapseGaps），預設不摺疊 */
  collapseGaps?: boolean
  /**
   * 順序等距（只在出圖工作室）：事件依先後等距排列、不照時間比例。
   * 刻度改成每格寫年份、軸線畫成一段一段，圖的右上角固定標「非等比」
   */
  ordinal?: boolean
  /**
   * 版型 B「雙向對照」（只在匯出時）：刻度軸放在正中間、寫大年份，
   * 前半的軸線畫在軸的上方（車道往上疊），後半畫在下方。畫面上的檢視不受影響
   */
  centerAxis?: boolean
  /** 精簡模式：把事件列高、圓點、文字縮小，同樣高度塞更多事件、其他軸線比較看得到 */
  compact?: boolean
  /** 主題：字級、尺寸、顏色（預設「螢幕」主題） */
  theme?: RenderTheme
  /**
   * 版型 A「多軸泳道」的外觀：左側滿高色塊寫軸線名、頂部整條刻度帶、方頭長條。
   * 只在匯出（出圖工作室）時生效，畫面上的檢視不受影響
   */
  swimlane?: boolean
  /** 標註框：挑出來加「標題＋摘要」說明的事件（只在匯出時畫） */
  callouts?: CalloutSpec[]
  /** 目前被選取的事件（組合鍵），該事件會畫上光環 */
  selectedKey?: string | null
  /** 點事件 → 回報選取；點空白處 → 回報 null */
  onEventSelect?: (selection: EventSelection | null) => void
  /** 在軸線空白處點兩下 → 回報新增事件的草稿資訊（未提供時停用，例如嵌入模式） */
  onEventCreate?: (draft: NewEventDraft) => void
  /** 回報目前的可視時間範圍（壓縮座標 u），讓 ui 層的比例匯出做到所見即所得 */
  onDomainChange?: (domain: [number, number]) => void
  /** 受控的可視範圍（匯出時由外部指定；畫面上的檢視不傳） */
  domain?: [number, number]
  /** 有值 = 匯出模式（固定尺寸、不互動、上下加標題與出處） */
  exportMode?: HorizontalExportOptions
}

/**
 * 匯出模式：固定尺寸、不互動、上下加標題與出處。
 * 由 exportSvg.tsx 離屏渲染時使用——**畫面與匯出圖走同一段繪製程式**。
 */
export interface HorizontalExportOptions {
  /** 邏輯寬高（像素） */
  width: number
  height: number
  /** 離屏渲染時要換一個 id，避免跟畫面上的 SVG 撞名 */
  svgId: string
  /** 圖片頂部的標題（通常是文件名） */
  title: string
  /** 標題下方的副標（選填；有值時標題列會加高） */
  subtitle?: string
  /** 圖片底部左側的註記，例如「僅列關鍵事件（25 件中的 9 件）」 */
  note?: string
  /** 圖片底部的出處小字 */
  footer: string
}

const DAY = 86_400_000
// 以下是主題倍率 1 時的高度，實際使用時乘上主題倍率（字放大，格子也要跟著放大）
const BASE_AXIS_H = 46 // 頂部刻度列高度（上排放「可視範圍」文字，下排放刻度數字，避免兩者疊在一起）

/** 各尺度按鈕對應的可視時間跨度 */
const SCALE_SPANS: Record<Exclude<ScaleMode, 'year'>, number> = {
  day: 14 * DAY,
  week: 91 * DAY,
  month: 730 * DAY,
}
const MIN_SPAN = DAY / 4 // 最多放大到 6 小時
const MAX_SPAN = 400 * 365 * DAY // 最多縮小到 400 年
const BASE_TITLE_H = 42 // 匯出圖片頂部的標題列
const BASE_TITLE_SUB_H = 64 // 有副標時的標題列
const BASE_LANE_LABEL_W = 132 // 泳道外觀：左側軸線名色塊的寬度
const BASE_FOOTER_H = 22 // 匯出圖片底部的出處小字

export function TimelineView({
  sources,
  scaleRequest,
  onScaleModeChange,
  showDates = true,
  showYears = true,
  dateParts,
  showRelations = true,
  collapseGaps = false,
  ordinal = false,
  centerAxis = false,
  compact = false,
  theme = THEMES.screen,
  swimlane = false,
  callouts,
  selectedKey,
  onEventSelect,
  onEventCreate,
  onDomainChange,
  domain: domainProp,
  exportMode,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  // 0 = 還沒量到容器寬度。量到之前不畫，避免先用預設值畫一次再跳版
  const [measuredWidth, setMeasuredWidth] = useState(0)
  const width = exportMode?.width ?? measuredWidth
  const isExport = exportMode != null

  // 尺寸度量全部來自主題；精簡模式＝同一個主題換成 compact 密度。
  // 事件的圓點、長條、文字、車道高度、軸線間距都跟著這組數字走。
  const T = useMemo(
    () => deriveTheme(theme, compact ? { density: 'compact' } : {}),
    [theme, compact],
  )
  const C = T.colors
  const F = T.font
  const S = T.scale
  const AXIS_H = BASE_AXIS_H * S
  // 雙向對照：刻度軸在中間，軸帶加高放大年份
  const center = centerAxis && !!exportMode
  const CENTER_AXIS_H = F.title * 1.6 + 22 * S
  // 標題、副標太長時各自換成最多兩行，標題列跟著加高（順序等距時標題讓出右上角的「非等比」標示）
  const header = exportMode
    ? layoutExportHeader(
        exportMode.title,
        exportMode.subtitle,
        width,
        T,
        ordinal ? ordinalBadgeWidth(T, width / 2) + 12 * S : 0,
      )
    : null
  const TITLE_H = header ? header.height : (exportMode?.subtitle ? BASE_TITLE_SUB_H : BASE_TITLE_H) * S
  // 有底部註記時（例如「僅列關鍵事件」）多留一行，註記放在出處行上面，窄圖也不會擠在一起
  const FOOTER_H = exportMode
    ? exportFooterHeight(BASE_FOOTER_H * S, exportMode.footer, exportMode.note, width, T)
    : BASE_FOOTER_H * S
  // 泳道外觀（版型 A，只在匯出時）：時間軸往右讓出一欄給軸線名色塊。
  // 沒開時 plotL = 0、plotW = width，所有座標與以前完全相同
  const lane = swimlane && !!exportMode
  const plotL = lane ? BASE_LANE_LABEL_W * S : 0
  const plotW = Math.max(1, width - plotL)
  const M = useMemo(
    () => ({
      laneH: T.laneH,
      trackLabelH: T.trackLabelH,
      bandGap: T.bandGap,
      dotR: T.dotR,
      keyDotR: T.keyDotR,
      barH: T.barH,
      keyBarH: T.keyBarH,
      font: T.font.event,
    }),
    [T],
  )
  // 軸線名改畫在左側色塊裡（泳道外觀），軸線上方就不必再留一列標題
  const labelRowH = lane ? 8 * S : M.trackLabelH

  // 與方向無關的資料準備都交給資料層（timelineData）：相對時間求解、空白摺疊
  // 對應、初始可視範圍、事件定位時間。分兩步呼叫是為了快取——切換「顯示日期」
  // 之類的文字選項時不必重算 warp，畫面才不會跳。
  const base = useMemo(
    () => buildTimelineBase(sources, collapseGaps, ordinal),
    [sources, collapseGaps, ordinal],
  )
  const { warp, initialDomain, anchorTimes } = base

  // 每條軸線要畫哪些事件、它們的時間範圍與標題文字（同樣與方向無關）
  const preparedBands = useMemo(
    () => buildBands(sources, base, { showDates, showYears, dateParts }, T.palette),
    [sources, base, showDates, showYears, dateParts, T.palette],
  )

  // 雙向對照的標註框：上半軸線的事件往上方放、下半的往下方放，引線才不會穿過中間的刻度軸。
  // 有標註的那一側，在圖的最外緣預留一條剛好放得下一排標註框的空間
  const calloutSides = useMemo(() => {
    const sideOf = new Map<string, 'top' | 'bottom'>()
    if (!center || !callouts?.length) return { sideOf, top: 0, bottom: 0 }
    const half = Math.ceil(preparedBands.length / 2)
    preparedBands.forEach((b, i) =>
      b.events.forEach((pe) => sideOf.set(`${b.sourceId}/${pe.ev.id}`, i < half ? 'top' : 'bottom')),
    )
    return {
      sideOf,
      top: callouts.filter((c) => sideOf.get(c.key) === 'top').length,
      bottom: callouts.filter((c) => sideOf.get(c.key) === 'bottom').length,
    }
  }, [center, callouts, preparedBands])
  /** 放得下 count 個標註框的標註帶要多高：一排放不下就多排幾排 */
  const calloutStripH = (count: number) => {
    if (count === 0) return 0
    const m = calloutMetrics(T, 0)
    // 一個框最高：標題兩行＋摘要兩行
    const boxH = m.pad * 2 + 2 * m.titleFont * m.lineHeight + 2 * m.summaryFont * m.lineHeight
    const perRow = Math.max(1, Math.floor((width - plotL - 8 * S) / (m.boxW + m.gap * 2)))
    return Math.ceil(count / perRow) * (boxH + m.gap) + m.gap
  }

  // 時期底色（SPEC 7.5）：第一份有時期的圖層畫滿版淡色底，其他圖層只在刻度旁畫細條
  const periodLayout = useMemo(() => {
    const { primary, others } = periodSources(sources)
    return {
      bands: primary ? layoutPeriods(primary.doc.periods, warp, C.periodFills, `${primary.id}/`) : [],
      strips: others.map((src, i) => ({
        key: src.id,
        color: src.color ?? C.inkFaint,
        row: i,
        bands: layoutPeriods(src.doc.periods, warp, C.periodFills, `${src.id}/`),
      })),
    }
  }, [sources, warp, C.periodFills, C.inkFaint])

  // domainState 為 null 代表「跟著初始範圍走」（尚未縮放，或按了「年」回到全貌）。
  // 這樣切換圖層顯示隱藏時，使用者已縮放的視野不會被重設。
  const [domainState, setDomainState] = useState<[number, number] | null>(null)
  const domain = domainProp ?? domainState ?? initialDomain
  const domainRef = useRef(domain)
  domainRef.current = domain

  // 摺疊開關或資料變動時 warp 會換：把已縮放的視野換算到新座標，畫面才不會跳走
  const prevWarpRef = useRef(warp)
  useEffect(() => {
    const prev = prevWarpRef.current
    if (prev === warp) return
    setDomainState((d) =>
      d ? [warp.toU(prev.toT(d[0])), warp.toU(prev.toT(d[1]))] : d,
    )
    prevWarpRef.current = warp
  }, [warp])

  // 量測容器寬度，讓 SVG 跟著視窗伸縮
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0].contentRect.width
      if (w > 0) setMeasuredWidth(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 目前被選取事件的位置（壓縮座標 u）。找不到或沒選取為 null。
  // 切刻度置中、以及「回到選取事件」浮動鈕都靠這個。
  const selectedU = useMemo(() => {
    if (!selectedKey) return null
    const t = anchorTimes.get(selectedKey)
    return t != null ? warp.toU(t) : null
  }, [selectedKey, anchorTimes, warp])

  // ui 層的尺度按鈕：日/週/月 → 切換跨度；年 → 回到全貌。
  // 有選取事件時以「該事件」為中心縮放（切刻度不再讓事件跑出畫面）；否則沿用畫面中心。
  useEffect(() => {
    if (!scaleRequest) return
    if (scaleRequest.mode === 'year') {
      setDomainState(null)
      return
    }
    const span = SCALE_SPANS[scaleRequest.mode]
    const [a, b] = domainRef.current
    const center = selectedU ?? (a + b) / 2
    setDomainState([center - span / 2, center + span / 2])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scaleRequest?.nonce])

  // 回報目前看到的時間範圍：ui 層的「比例匯出」要照著這個範圍出圖（所見即所得）
  useEffect(() => {
    onDomainChange?.(domain)
  }, [domain, onDomainChange])

  // 回報目前尺度，讓按鈕高亮跟著縮放狀態走
  useEffect(() => {
    const span = domain[1] - domain[0]
    const mode: ScaleMode =
      span <= 30 * DAY ? 'day' : span <= 200 * DAY ? 'week' : span <= 1500 * DAY ? 'month' : 'year'
    onScaleModeChange?.(mode)
  }, [domain, onScaleModeChange])

  // 滑鼠滾輪縮放（以游標位置為錨點）。需要 passive: false 才能擋掉頁面捲動。
  // Shift＋滾輪改為上下捲動軸線（給沒有觸控板、只能用滾輪的使用者）。
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      // Shift＋滾輪：上下捲動軸線（部分系統會把捲動量放到 deltaX，兩者取其一）
      if (e.shiftKey) {
        const c = containerRef.current
        if (c) {
          e.preventDefault()
          c.scrollTop += e.deltaY || e.deltaX
        }
        return
      }
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const f = (e.clientX - rect.left) / rect.width
      const [a, b] = domainRef.current
      const span = b - a
      const k = Math.exp(e.deltaY * 0.0015)
      const newSpan = Math.min(MAX_SPAN, Math.max(MIN_SPAN, span * k))
      const anchor = a + f * span
      const a2 = anchor - f * newSpan
      setDomainState([a2, a2 + newSpan])
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
    // width > 0 也要進依賴：量到寬度前 svg 還沒畫出來，那時掛不上監聽
  }, [sources.length > 0, width > 0]) // 空狀態沒有 svg，出現後要重掛監聽

  // 拖曳：左右＝平移時間，上下＝捲動軸線（第一次超過門檻時鎖定方向，避免斜拖抖動）
  const dragState = useRef<{
    startX: number
    startY: number
    domain: [number, number]
    startScrollTop: number
    axis: 'x' | 'y' | null
  } | null>(null)
  // 這次按下之後有沒有實際拖動（拖動結束的 click 不應該被當成「點空白處取消選取」）
  const draggedRef = useRef(false)
  // 滑鼠懸停的事件：不用點擊，關係線就會先亮起來
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)
  // 滑鼠懸停的軸線（band key）：hover 時才浮現「跳到最早／最新事件」按鈕，平常不佔畫面
  const [hoveredBand, setHoveredBand] = useState<string | null>(null)

  // 跳到某個位置（u 座標）：保持目前跨度、把該位置置中
  const jumpToU = (u: number) => {
    const [a, b] = domainRef.current
    const span = b - a
    setDomainState([u - span / 2, u + span / 2])
  }

  // ---- 排版計算（橫式：把資料層算好的時間換算成像素）----
  const layout = useMemo(() => {
    const [a, b] = domain
    // 先把真實時間換算到壓縮座標，再投影到像素
    const x = (t: number) => plotL + ((warp.toU(t) - a) / (b - a)) * plotW

    let y = center ? 8 * S + calloutStripH(calloutSides.top) : AXIS_H + 8 * S
    // 雙向對照：前半（無條件進位）在軸上方、後半在下方
    const half = Math.ceil(preparedBands.length / 2)
    let axisTop = 0

    const bands = preparedBands.map((band, bandIndex) => {
      // 輪到下半的第一條時，先放中間的刻度軸
      if (center && bandIndex === half) {
        axisTop = y
        y += CENTER_AXIS_H + M.bandGap
      }
      // 軸上方的軸線車道往上疊：第 0 列貼著刻度軸
      const flipped = center && bandIndex < half
      const items = band.events
        .map((pe) => {
          const dotR = pe.isKey ? M.keyDotR : M.dotR
          let shapeL: number
          let shapeR: number
          if (pe.kind === 'bar') {
            // 區間／進行中事件 = 長條（太短時至少留 6px 才看得見）
            const x1 = x(pe.tStart)
            shapeL = x1
            shapeR = Math.max(x(pe.tEnd), x1 + 6)
          } else {
            // 點事件 = 圓點，畫在精度範圍的中點
            const cx = x(pe.tStart)
            shapeL = cx - dotR
            shapeR = cx + dotR
          }

          let labelW = estimateTextWidth(
            pe.dateLabel ? `${pe.dateLabel} ${pe.title}` : pe.title,
            M.font,
          )
          // 標題預設放在圖形右側；右邊放不下時翻到左側，避免被畫面邊緣切掉
          let labelSide: 'right' | 'left' =
            shapeR + 6 * S + labelW > width && shapeL - 6 * S - labelW > plotL ? 'left' : 'right'
          let label = pe.title
          let dateLabel = pe.dateLabel
          let clipped = false
          // 出圖時畫布是固定的：左右兩邊都放不下，就挑空間大的一邊把標題截短（加「…」），
          // 絕不讓字跑出圖外被切掉；連一個字都放不下的，回報給出圖工作室擋下載
          if (isExport) {
            const spaceR = width - (shapeR + 6 * S) - 2 * S
            const spaceL = shapeL - 6 * S - plotL - 2 * S
            if (labelW > spaceR && labelW > spaceL) {
              labelSide = spaceR >= spaceL ? 'right' : 'left'
              const avail = Math.max(spaceR, spaceL)
              const prefixW = dateLabel ? estimateTextWidth(`${dateLabel} `, M.font) : 0
              label = fitText(pe.title, avail - prefixW, M.font)
              // 連日期都擠不下時，寧可捨棄日期也要留住標題
              if ((label === '' || label === '…') && dateLabel) {
                dateLabel = ''
                label = fitText(pe.title, avail, M.font)
              }
              clipped = label === '' || label === '…'
              labelW = (dateLabel ? estimateTextWidth(`${dateLabel} `, M.font) : 0) + estimateTextWidth(label, M.font)
            }
          }
          const occL = labelSide === 'left' ? shapeL - 6 * S - labelW : shapeL
          const occR = labelSide === 'right' ? shapeR + 6 * S + labelW : shapeR
          return { ...pe, label, dateLabel, clipped, shapeL, shapeR, labelSide, occL, occR }
        })
        // 出圖時，範圍外的事件不畫、也不佔列——否則看不見的事件會把軸線撐高，圖白白變長
        // （螢幕上保留全部，平移時各事件的列才不會跳來跳去）
        // 圓點看中心、長條看有沒有重疊：切成多張圖時，分界旁的圓點才不會兩張都露出半個
        .filter((it) => {
          if (!isExport) return true
          if (it.kind === 'bar') return it.shapeR >= plotL && it.shapeL <= width
          const cx = (it.shapeL + it.shapeR) / 2
          return cx >= plotL && cx <= width
        })
        .sort((p, q) => p.occL - q.occL)

      const lanes = assignLanes(items.map((it) => ({ left: it.occL, right: it.occR })))
      const laneCount = items.length > 0 ? Math.max(...lanes) + 1 : 1
      const bandTop = y
      // 泳道外觀：軸線名折行放進左側色塊（有「文件｜軸線」時分兩層：文件名小字、軸線名粗體），
      // 軸線至少要高到放得下這些字
      let laneLabel: { head: string[]; tail: string[] } | null = null
      let labelBlockH = 0
      if (lane) {
        const [head, tail] = band.label.includes('｜')
          ? [band.label.slice(0, band.label.indexOf('｜')), band.label.slice(band.label.indexOf('｜') + 1)]
          : ['', band.label]
        const textW = plotL - 4 * S - 20 * S
        laneLabel = {
          head: head ? wrapLines(head, textW, F.date, 2) : [],
          tail: wrapLines(tail, textW, F.track, 3),
        }
        labelBlockH =
          laneLabel.head.length * F.date * 1.4 + laneLabel.tail.length * F.track * 1.4 + 20 * S
      }
      const bandH = Math.max(labelRowH + laneCount * M.laneH + 6 * S, labelBlockH)
      y += bandH + M.bandGap

      // 這條軸線最早／最新事件的位置（u 座標），供 hover 浮現的跳轉按鈕使用
      let firstU = Infinity
      let lastU = -Infinity
      for (const it of items) {
        if (it.u < firstU) firstU = it.u
        if (it.u > lastU) lastU = it.u
      }

      return {
        key: band.key,
        sourceId: band.sourceId,
        trackId: band.trackId,
        docTitle: band.docTitle,
        trackTitle: band.trackTitle,
        label: band.label,
        laneLabel,
        color: band.color,
        bandTop,
        bandH,
        firstU: items.length > 0 ? firstU : null,
        lastU: items.length > 0 ? lastU : null,
        items: items.map((it, j) => ({
          ...it,
          lane: lanes[j],
          cy: flipped
            ? bandTop + bandH - labelRowH - lanes[j] * M.laneH - M.laneH / 2
            : bandTop + labelRowH + lanes[j] * M.laneH + M.laneH / 2,
        })),
      }
    })

    // 每個事件圖形的中心點，供關係線定位
    const anchors = new Map<string, { x: number; y: number }>()
    for (const band of bands) {
      for (const it of band.items) {
        anchors.set(`${band.sourceId}/${it.ev.id}`, { x: (it.shapeL + it.shapeR) / 2, y: it.cy })
      }
    }

    // 關係線：只連同一份文件內、兩端都畫得出來的事件。
    // 跨文件關係（fromDoc／toDoc）先在這裡濾掉——事件 id 只在文件內唯一，
    // 若不明確略過，外部 id 剛好與本文件事件同名時會畫出一條錯誤的線。
    // 路徑與說明標籤的位置在這裡先算好，說明標籤會畫在最上層避免與事件文字交疊。
    const relationLines = sources.flatMap((source) =>
      sameDocumentRelations(source.doc.relations).flatMap((rel, i) => {
        const fromKey = `${source.id}/${rel.from}`
        const toKey = `${source.id}/${rel.to}`
        const from = anchors.get(fromKey)
        const to = anchors.get(toKey)
        if (!from || !to) return []

        const sameLevel = Math.abs(from.y - to.y) < 12
        const midY = sameLevel ? Math.min(from.y, to.y) - 44 : (from.y + to.y) / 2
        const d = sameLevel
          ? `M ${from.x} ${from.y - 8} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${to.y - 8}`
          : `M ${from.x} ${from.y} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${to.y}`

        const label = rel.label ?? RELATION_LABELS[rel.type] ?? rel.type
        // 標籤底框的尺寸與位置（夾在畫面內，不被切出去）
        const labelW = estimateTextWidth(label, F.date) + 18 * S
        const labelX = Math.min(
          Math.max((from.x + to.x) / 2, plotL + labelW / 2 + 4),
          width - labelW / 2 - 4,
        )
        return [
          {
            id: `${source.id}/rel-${i}`,
            d,
            fromKey,
            toKey,
            type: rel.type,
            label,
            labelW,
            labelX,
            labelY: midY,
          },
        ]
      }),
    )

    // 只有一條軸線時沒有「下半」，刻度軸放在最後
    if (center && preparedBands.length <= half) {
      axisTop = y
      y += CENTER_AXIS_H + M.bandGap
    }
    // 下半軸線的標註框放在最下方預留的這一條
    if (center) y += calloutStripH(calloutSides.bottom)

    // 出圖時標題連一個字都放不下的事件數（出圖工作室據此擋下載）
    const clippedLabels = bands.reduce((n, b) => n + b.items.filter((it) => it.clipped).length, 0)

    return { bands, relationLines, anchors, height: Math.max(y + 8, 320), x, axisTop, clippedLabels }
  }, [sources, preparedBands, domain, width, warp, M, F, S, AXIS_H, lane, plotL, plotW, labelRowH, isExport, center, CENTER_AXIS_H, calloutSides, T])

  // 沒有任何可見圖層：顯示提示文字
  if (sources.length === 0) {
    return (
      <div ref={containerRef} className="flex h-full items-center justify-center text-slate-400">
        沒有可顯示的圖層——請在左側面板勾選或載入 .hst.json 檔案
      </div>
    )
  }

  // 可視範圍（真實時間）與其中的密集子區間（扣掉摺疊的空白）
  const tView: [number, number] = [warp.toT(domain[0]), warp.toT(domain[1])]
  const denseRanges: Array<[number, number]> = []
  {
    let cursor = tView[0]
    for (const g of warp.gaps) {
      if (g.tEnd <= tView[0] || g.tStart >= tView[1]) continue
      if (g.tStart > cursor) denseRanges.push([cursor, g.tStart])
      cursor = Math.max(cursor, g.tEnd)
    }
    if (cursor < tView[1]) denseRanges.push([cursor, tView[1]])
  }
  // 每段密集區依自己佔的像素寬各自產生刻度，摺疊區內不放刻度
  const ticks = denseRanges.flatMap(([a, b]) => {
    const px = ((warp.toU(b) - warp.toU(a)) / (domain[1] - domain[0])) * plotW
    if (px < 50) return []
    return getTicks([a, b], px).filter((d) => d.getTime() >= a && d.getTime() <= b)
  })
  // 壓縮座標 → 像素（畫斷軸記號用）
  const xOfU = (u: number) => plotL + ((u - domain[0]) / (domain[1] - domain[0])) * plotW
  // 順序等距：不畫規律刻度，改成每一格（事件的時間點）一條格線；年份寫在格子上，太擠就跳過
  const slots = warp.ordinalSlots
  const slotXs = slots ? slots.map((t) => xOfU(warp.toU(t))).filter((x) => x >= plotL && x <= width) : []
  const slotPx = (ORDINAL_STEP / (domain[1] - domain[0])) * plotW
  const tickMarks: Array<{ x: number; label: string }> = slots
    ? ordinalTicks(slots, (t) => xOfU(warp.toU(t)), estimateTextWidth('0000', lane ? F.track : F.event) + 10 * S)
        .filter((m) => m.pos >= plotL && m.pos <= width)
        .map((m) => ({ x: m.pos, label: m.label }))
    : ticks.map((d) => ({ x: layout.x(d.getTime()), label: formatTick(d) }))
  const gridXs = slots ? slotXs : tickMarks.map((m) => m.x)
  // 出圖時，貼在圖邊緣、字會被切掉一半的刻度（例如右上角只剩「19」）就不寫；螢幕上照舊
  const edgeSafeTicks = isExport
    ? tickMarks.filter((m) => {
        const half = estimateTextWidth(m.label, lane ? F.track : F.event) / 2
        return m.x - half >= (lane ? plotL : 0) && m.x + half <= width - 2 * S
      })
    : tickMarks
  // 雙向對照的大年份：字大，摺疊處兩側的刻度容易擠在一起、最右邊的會被切掉——太擠或出界的就不寫
  const centerTicks = center
    ? (() => {
        const half = estimateTextWidth('0000', F.title) / 2
        const out: typeof tickMarks = []
        for (const m of tickMarks) {
          if (m.x - half < plotL || m.x + half > width - 2 * S) continue
          const prev = out[out.length - 1]
          if (prev && m.x - prev.x < half * 2 + 12 * S) continue
          out.push(m)
        }
        return out
      })()
    : tickMarks

  // 「回到選取的事件」：選取的事件被平移／縮放到畫面外時，往它的方向浮現一顆小鈕拉它回來。
  // 事件在畫面內時鈕自動消失——平常完全不佔畫面。
  const selectionDir: 'left' | 'right' | null =
    selectedU == null || (selectedU >= domain[0] && selectedU <= domain[1])
      ? null
      : selectedU < domain[0]
        ? 'left'
        : 'right'
  const returnToSelection = () => {
    if (selectedU == null) return
    const span = domain[1] - domain[0]
    setDomainState([selectedU - span / 2, selectedU + span / 2])
  }

  // 匯出模式：上面留標題列、下面留出處，中間才是時間軸；放不下的軸線會被裁掉
  const exportTop = exportMode ? TITLE_H : 0
  const exportAvailH = exportMode ? exportMode.height - TITLE_H - FOOTER_H : 0
  // 容許半個像素的誤差：自動長度的畫布剛好等於內容高度時，小數誤差不該被當成「放不下」
  const exportOverflow = exportMode ? layout.height > exportAvailH + 0.5 : false

  // 標註框（只在匯出時）：找得到事件位置的才排，其餘（範圍外、被裁掉）算放不下。
  // 框絕不蓋到事件文字，只放在畫布的空白處；自動長度試算時畫布很長，
  // 框若得放到軸線下方，圖就會拉長到剛好放得下（見 data-content-height）
  const calloutLayout =
    exportMode && callouts && callouts.length > 0
      ? (() => {
          const bottom = exportAvailH - 4 * S
          const withAnchor = callouts.flatMap((c) => {
            const a = layout.anchors.get(c.key)
            return a && a.x >= plotL && a.x <= width && a.y <= Math.min(layout.height, exportAvailH)
              ? [{ ...c, anchorX: a.x, anchorY: a.y }]
              : []
          })
          // 每個事件的圖形＋文字佔的範圍：標註框盡量不蓋到
          const obstacles = layout.bands.flatMap((b) =>
            b.items.map((it) => ({ x: it.occL, y: it.cy - M.laneH / 2, w: it.occR - it.occL, h: M.laneH })),
          )
          // 雙向對照：中間的刻度軸帶也不能蓋
          if (center) obstacles.push({ x: 0, y: layout.axisTop, w: width, h: CENTER_AXIS_H })
          // 框可以放遠一點（引線拉長），只要不蓋到事件
          const metrics = calloutMetrics(T, Math.max(width, exportAvailH))
          const result = center
            ? (() => {
                // 雙向對照：上半只在刻度軸上方找位置、下半只在下方，引線不穿過刻度軸
                const up = withAnchor.filter((c) => calloutSides.sideOf.get(c.key) !== 'bottom')
                const down = withAnchor.filter((c) => calloutSides.sideOf.get(c.key) === 'bottom')
                const left = plotL + 4 * S
                const right = width - 4 * S
                const a = placeCallouts(
                  up,
                  { left, top: 4 * S, right, bottom: layout.axisTop - 4 * S },
                  'horizontal',
                  metrics,
                  obstacles,
                  'above',
                )
                const b = placeCallouts(
                  down,
                  {
                    left,
                    top: layout.axisTop + CENTER_AXIS_H + 4 * S,
                    right,
                    bottom: Math.min(layout.height, exportAvailH) - 4 * S,
                  },
                  'horizontal',
                  metrics,
                  obstacles,
                  'below',
                )
                return { placed: [...a.placed, ...b.placed], dropped: [...a.dropped, ...b.dropped] }
              })()
            : placeCallouts(
                withAnchor,
                { left: plotL + 4 * S, top: AXIS_H + 4 * S, right: width - 4 * S, bottom },
                'horizontal',
                metrics,
                obstacles,
              )
          const missing = callouts.filter((c) => !withAnchor.some((w) => w.key === c.key)).map((c) => c.key)
          return { placed: result.placed, dropped: [...result.dropped, ...missing] }
        })()
      : null

  // 畫面上的檢視與匯出圖片共用同一段 SVG——「看到的」與「存下來的」保證一致
  const svgEl = (
      <svg
        ref={svgRef}
        id={exportMode?.svgId ?? 'hackstory-timeline-svg'}
        width={width}
        height={exportMode ? exportMode.height : layout.height}
        className={exportMode ? 'block' : 'block cursor-grab active:cursor-grabbing'}
        style={exportMode ? { background: C.bg } : { background: C.bg, touchAction: 'none' }}
        data-overflow={exportOverflow ? '1' : '0'}
        // 標題放不下（只剩圓點）的事件數
        data-clipped={exportMode ? layout.clippedLabels : undefined}
        // 放不下而省略的標註（事件 key，以 | 分隔），讓出圖工作室能告訴使用者
        data-callouts-dropped={calloutLayout ? calloutLayout.dropped.join('|') : undefined}
        // 全部軸線都放得下需要的高度（出圖工作室「自動長度」用）
        // 標題、副標兩行還放不下被截短了（出圖工作室在輸入框下提醒）
        data-title-truncated={header?.titleTruncated ? '1' : undefined}
        data-subtitle-truncated={header?.subtitleTruncated ? '1' : undefined}
        data-content-height={
          exportMode
            ? Math.ceil(
                exportTop +
                  Math.max(
                    layout.height,
                    ...(calloutLayout?.placed ?? []).map((p) => p.y + p.h + 10 * S),
                  ) +
                  FOOTER_H,
              )
            : undefined
        }
        onPointerDown={exportMode ? undefined : (e) => {
          dragState.current = {
            startX: e.clientX,
            startY: e.clientY,
            domain,
            startScrollTop: containerRef.current?.scrollTop ?? 0,
            axis: null,
          }
          draggedRef.current = false
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={exportMode ? undefined : (e) => {
          // 依游標的 Y 判斷停在哪條軸線上（hover 才浮現跳轉按鈕）
          const rect = e.currentTarget.getBoundingClientRect()
          const yPix = e.clientY - rect.top
          const band = layout.bands.find((bd) => yPix >= bd.bandTop && yPix <= bd.bandTop + bd.bandH)
          setHoveredBand(band ? band.key : null)
          const drag = dragState.current
          if (!drag) return
          const dx = e.clientX - drag.startX
          const dy = e.clientY - drag.startY
          if (Math.abs(dx) > 4 || Math.abs(dy) > 4) draggedRef.current = true
          // 第一次超過門檻時鎖定方向：水平＝平移時間，垂直＝捲動軸線
          if (!drag.axis && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
            drag.axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y'
          }
          if (drag.axis === 'y') {
            // 抓著畫面上下拉：往上拉看下面的軸線（grab 捲動）
            if (containerRef.current) containerRef.current.scrollTop = drag.startScrollTop - dy
          } else if (drag.axis === 'x') {
            const [a, b] = drag.domain
            const dt = (dx / width) * (b - a)
            setDomainState([a - dt, b - dt])
          }
        }}
        onPointerLeave={exportMode ? undefined : () => setHoveredBand(null)}
        onPointerUp={exportMode ? undefined : () => (dragState.current = null)}
        onPointerCancel={exportMode ? undefined : () => (dragState.current = null)}
        onClick={exportMode ? undefined : () => {
          // 點空白處（不是拖曳）→ 取消選取
          if (!draggedRef.current) onEventSelect?.(null)
        }}
        onDoubleClick={exportMode ? undefined : (e) => {
          // 在軸線空白處點兩下 → 以該位置的日期與軸線開「新增事件」
          if (!onEventCreate) return
          const rect = e.currentTarget.getBoundingClientRect()
          const xPix = e.clientX - rect.left
          const yPix = e.clientY - rect.top
          const band = layout.bands.find((b) => yPix >= b.bandTop && yPix <= b.bandTop + b.bandH)
          if (!band) return
          const u = domain[0] + (xPix / width) * (domain[1] - domain[0])
          const d = new Date(warp.toT(u))
          onEventCreate({
            sourceId: band.sourceId,
            trackId: band.trackId,
            docTitle: band.docTitle,
            trackTitle: band.trackTitle,
            color: band.color,
            dateRaw: `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`,
            clientX: e.clientX,
            clientY: e.clientY,
          })
        }}
      >
        {/* 匯出圖片的頂部標題：輸出的圖自帶脈絡，不必靠貼文說明 */}
        {exportMode && (
          <>
            {header && <ExportHeader layout={header} x={14 * S} theme={T} />}
            {/* 順序等距：右上角固定標「非等比」，不可關閉 */}
            {slots && <OrdinalBadge right={width - 12 * S} top={11 * S} theme={T} maxW={width / 2} />}
            <clipPath id="hst-export-clip">
              <rect x={0} y={0} width={width} height={exportAvailH} />
            </clipPath>
          </>
        )}
        <g
          transform={exportMode ? `translate(0 ${exportTop})` : undefined}
          clipPath={exportMode ? 'url(#hst-export-clip)' : undefined}
        >
        {/* 進行中事件右端的淡出漸層 */}
        <defs>
          <linearGradient id="hst-ongoing-fade" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor={C.halo} stopOpacity="0" />
            <stop offset="1" stopColor={C.halo} stopOpacity="1" />
          </linearGradient>
        </defs>
        {/* 時期底色：畫在最底層，軸線、格線、事件都疊在上面。名稱寫在帶子起點的上角 */}
        {periodLayout.bands.map((pb) => {
          const x0 = Math.max(plotL, xOfU(pb.u0))
          const x1 = Math.min(width, xOfU(pb.u1))
          if (x1 - x0 < 1) return null
          const top = center ? 0 : AXIS_H
          const name = fitText(pb.title, x1 - x0 - 8 * S, F.date)
          return (
            <g key={pb.key} data-period={pb.key}>
              <title>{pb.description ? `${pb.title}：${pb.description}` : pb.title}</title>
              <rect x={x0} y={top} width={x1 - x0} height={layout.height - top} fill={pb.fill} opacity={pb.opacity} />
              {name && (
                <text
                  x={x0 + 4 * S}
                  y={top + F.date + 3 * S}
                  fontSize={F.date}
                  fontWeight={600}
                  fill={C.inkMuted}
                  stroke={C.bg}
                  strokeWidth={3 * S}
                  paintOrder="stroke"
                >
                  {name}
                </text>
              )}
            </g>
          )
        })}
        {!center && (
          <>
        {/* 泳道外觀：頂部整條刻度帶（淡底、粗年份） */}
        {lane && <rect x={0} y={0} width={width} height={AXIS_H} fill={C.grid} opacity={0.6} />}
        {/* 直式格線 */}
        {gridXs.map((x, i) => (
          <line key={i} x1={x} x2={x} y1={AXIS_H} y2={layout.height} stroke={C.grid} strokeWidth={1} />
        ))}

        {/* 頂部刻度列。順序等距時軸線畫成一段一段（每格一段、格與格之間斷開），一看就知道不是連續的時間 */}
        {slots ? (
          slotXs.map((x, i) => (
            <line
              key={`seg-${i}`}
              x1={Math.max(plotL, x - slotPx / 2 + 3 * S)}
              x2={Math.min(width, x + slotPx / 2 - 3 * S)}
              y1={AXIS_H}
              y2={AXIS_H}
              stroke={C.axis}
              strokeWidth={1.5 * S}
            />
          ))
        ) : (
          <line x1={0} x2={width} y1={AXIS_H} y2={AXIS_H} stroke={C.axis} />
        )}
        {edgeSafeTicks.map((m, i) => (
          <text
            key={i}
            x={m.x}
            y={AXIS_H - 10 * S}
            textAnchor="middle"
            fontSize={lane ? F.track : F.event}
            fontWeight={lane ? 700 : undefined}
            fill={lane ? C.ink : C.inkMuted}
          >
            {m.label}
          </text>
        ))}
        {/* 左上角：目前可視範圍 */}
        <text x={8 * S} y={14 * S} fontSize={F.date} fill={C.inkFaint}>
          {formatRangeLabel(tView)}
        </text>

        {/* 斷軸記號：⫽ 加上「略過多久」，虛線貫穿到底 */}
        {warp.gaps.map((g, i) => {
          const xg = xOfU(g.uCenter)
          if (xg < plotL - 30 || xg > width + 30) return null
          return (
            <g key={`gap-${i}`}>
              <line x1={xg - 6 * S} y1={AXIS_H - 5 * S} x2={xg - 1 * S} y2={AXIS_H + 5 * S} stroke={C.inkFaint} strokeWidth={1.5 * S} />
              <line x1={xg + 1 * S} y1={AXIS_H - 5 * S} x2={xg + 6 * S} y2={AXIS_H + 5 * S} stroke={C.inkFaint} strokeWidth={1.5 * S} />
              <line
                x1={xg}
                y1={AXIS_H + 5 * S}
                x2={xg}
                y2={layout.height}
                stroke={C.axis}
                strokeDasharray="2 6"
              />
              {/* 「略過多久」放在頂部上排（與可視範圍文字同排），
                  避開下排的刻度數字，兩者不再擦到 */}
              <text x={xg} y={14 * S} textAnchor="middle" fontSize={F.footer} fill={C.inkFaint}>
                {formatSkipped(g.skippedMs)}
              </text>
            </g>
          )
        })}

          </>
        )}
        {/* 雙向對照：刻度軸在正中間（淡底帶、大年份），上下兩側各放一半的軸線 */}
        {center && (
          <>
            <rect x={0} y={layout.axisTop} width={width} height={CENTER_AXIS_H} fill={C.grid} opacity={0.6} />
            {gridXs.map((x, i) => (
              <line key={i} x1={x} x2={x} y1={0} y2={layout.height} stroke={C.grid} strokeWidth={1} />
            ))}
            {[layout.axisTop, layout.axisTop + CENTER_AXIS_H].map((ly) =>
              slots ? (
                slotXs.map((x, i) => (
                  <line
                    key={`seg-${ly}-${i}`}
                    x1={Math.max(plotL, x - slotPx / 2 + 3 * S)}
                    x2={Math.min(width, x + slotPx / 2 - 3 * S)}
                    y1={ly}
                    y2={ly}
                    stroke={C.axis}
                    strokeWidth={1.5 * S}
                  />
                ))
              ) : (
                <line key={`axis-${ly}`} x1={0} x2={width} y1={ly} y2={ly} stroke={C.axis} />
              ),
            )}
            {centerTicks.map((m, i) => (
              <text
                key={i}
                x={m.x}
                y={layout.axisTop + CENTER_AXIS_H / 2 + F.title * 0.36}
                textAnchor="middle"
                fontSize={F.title}
                fontWeight={700}
                fill={C.ink}
              >
                {m.label}
              </text>
            ))}
            {/* 可視範圍寫在軸帶左端（軸線名色塊那一欄） */}
            <text
              x={8 * S}
              y={layout.axisTop + CENTER_AXIS_H / 2 + F.date * 0.36}
              fontSize={F.date}
              fill={C.inkMuted}
            >
              {fitText(formatRangeLabel(tView), Math.max(40 * S, plotL - 12 * S), F.date)}
            </text>
            {/* 斷軸記號：⫽ 畫在軸帶上，「略過多久」寫在記號下方，虛線上下貫穿 */}
            {warp.gaps.map((g, i) => {
              const xg = xOfU(g.uCenter)
              if (xg < plotL - 30 || xg > width + 30) return null
              const my = layout.axisTop + CENTER_AXIS_H / 2 - 4 * S
              return (
                <g key={`gap-${i}`}>
                  <line x1={xg - 6 * S} y1={my - 5 * S} x2={xg - 1 * S} y2={my + 5 * S} stroke={C.inkFaint} strokeWidth={1.5 * S} />
                  <line x1={xg + 1 * S} y1={my - 5 * S} x2={xg + 6 * S} y2={my + 5 * S} stroke={C.inkFaint} strokeWidth={1.5 * S} />
                  <line x1={xg} y1={0} x2={xg} y2={layout.axisTop} stroke={C.axis} strokeDasharray="2 6" />
                  <line
                    x1={xg}
                    y1={layout.axisTop + CENTER_AXIS_H}
                    x2={xg}
                    y2={layout.height}
                    stroke={C.axis}
                    strokeDasharray="2 6"
                  />
                  <text
                    x={xg}
                    y={layout.axisTop + CENTER_AXIS_H - 5 * S}
                    textAnchor="middle"
                    fontSize={F.footer}
                    fill={C.inkFaint}
                  >
                    {formatSkipped(g.skippedMs)}
                  </text>
                </g>
              )
            })}
          </>
        )}
        {/* 其他圖層的時期：刻度線旁的細條（圖層色），滑鼠移上去看名稱 */}
        {periodLayout.strips.map((strip) =>
          strip.bands.map((pb) => {
            const x0 = Math.max(plotL, xOfU(pb.u0))
            const x1 = Math.min(width, xOfU(pb.u1))
            if (x1 - x0 < 1) return null
            const y0 = (center ? layout.axisTop + CENTER_AXIS_H : AXIS_H) - (strip.row + 1) * 4 * S
            return (
              <rect key={pb.key} x={x0} y={y0} width={x1 - x0} height={3 * S} fill={strip.color} opacity={0.7}>
                <title>{pb.description ? `${pb.title}：${pb.description}` : pb.title}</title>
              </rect>
            )
          }),
        )}

        {/* 軸線底色與標題 */}
        {layout.bands.map(({ key, label, color, bandTop, bandH }) => (
          <g key={`${key}-bg`}>
            <rect x={plotL} y={bandTop} width={plotW} height={bandH} fill={color} opacity={0.05} />
            {/* 泳道外觀的軸線名畫在左側色塊（最上層，見下方），這裡不重複 */}
            {!lane && (
              <>
                <rect x={0} y={bandTop} width={3} height={bandH} fill={color} />
                <text x={12 * S} y={bandTop + 18 * S} fontSize={F.track} fontWeight={700} fill={color}>
                  {label}
                </text>
              </>
            )}
          </g>
        ))}

        {/* 事件關係線（畫在事件圖形下方；點選事件時相關的線會亮起並顯示說明） */}
        {showRelations && layout.relationLines.length > 0 && (
          <g pointerEvents="none">
            <defs>
              <marker
                id="hst-rel-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="6.5"
                markerHeight="6.5"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
              </marker>
            </defs>
            {layout.relationLines.map(({ id, d, fromKey, toKey, type }) => {
              // 點選或滑鼠懸停的事件，其關係線都會亮起
              const active =
                selectedKey === fromKey ||
                selectedKey === toKey ||
                hoveredKey === fromKey ||
                hoveredKey === toKey
              return (
                <path
                  key={id}
                  d={d}
                  fill="none"
                  stroke={active ? C.highlight : C.inkFaint}
                  strokeWidth={(active ? 2.5 : 1.25) * S}
                  strokeDasharray={type === 'same_event' ? '4 3' : undefined}
                  opacity={active ? 0.95 : 0.4}
                  markerEnd="url(#hst-rel-arrow)"
                />
              )
            })}
          </g>
        )}

        {/* 事件 */}
        {layout.bands.map(({ key, sourceId, docTitle, trackTitle, color, items }) => (
          <g key={key}>
            {items.map(({ ev, kind, isKey, ongoing, estimate, relativeNote, shapeL, shapeR, label: text, dateLabel, labelSide, cy }) => {
              const fill = ev.color ?? color
              const eventKey = `${sourceId}/${ev.id}`
              const isSelected = selectedKey === eventKey
              const dotR = isKey ? M.keyDotR : M.dotR
              const barH = isKey ? M.keyBarH : M.barH
              return (
                <g
                  key={ev.id}
                  className="cursor-pointer"
                  // 按在事件上不啟動拖曳，讓 click 正常送達；
                  // 在事件上點兩下也不觸發「新增事件」
                  onPointerDown={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => e.stopPropagation()}
                  onMouseEnter={() => setHoveredKey(eventKey)}
                  onMouseLeave={() => setHoveredKey((prev) => (prev === eventKey ? null : prev))}
                  onClick={(e) => {
                    e.stopPropagation()
                    onEventSelect?.({
                      key: eventKey,
                      sourceId,
                      event: ev,
                      docTitle,
                      trackTitle,
                      color: fill,
                      relativeNote,
                      clientX: e.clientX,
                      clientY: e.clientY,
                    })
                  }}
                >
                  {/* 看不見的感應區：滑鼠不用精準壓在小圓點上也能 hover／點擊。
                      也當作事件的定位錨點——ui 層的詳情卡靠 data-event-key 找到它現在畫在哪裡 */}
                  {kind === 'bar' ? (
                    <rect
                      data-event-key={eventKey}
                      x={shapeL - 6}
                      y={cy - barH / 2 - 7}
                      width={shapeR - shapeL + 12}
                      height={barH + 14}
                      fill="transparent"
                    />
                  ) : (
                    <circle
                      data-event-key={eventKey}
                      cx={(shapeL + shapeR) / 2}
                      cy={cy}
                      r={dotR + 8}
                      fill="transparent"
                    />
                  )}
                  {/* 關鍵事件的常駐光暈 */}
                  {isKey &&
                    (kind === 'bar' ? (
                      <rect
                        x={shapeL - 4}
                        y={cy - barH / 2 - 4}
                        width={shapeR - shapeL + 8}
                        height={barH + 8}
                        rx={lane ? 4 * S : (barH + 8) / 2}
                        fill={fill}
                        opacity={0.15}
                      />
                    ) : (
                      /* 泳道外觀把關鍵事件的光暈加大加深，遠看也分得出重點 */
                      <circle
                        cx={(shapeL + shapeR) / 2}
                        cy={cy}
                        r={dotR + (lane ? 6 * S : 4)}
                        fill={fill}
                        opacity={lane ? 0.25 : 0.15}
                      />
                    ))}
                  {/* 選取光環 */}
                  {isSelected &&
                    (kind === 'bar' ? (
                      <rect
                        x={shapeL - 3}
                        y={cy - barH / 2 - 3}
                        width={shapeR - shapeL + 6}
                        height={barH + 6}
                        rx={lane ? 3 * S : (barH + 6) / 2}
                        fill="none"
                        stroke={fill}
                        strokeWidth={2}
                        opacity={0.5}
                      />
                    ) : (
                      <circle
                        cx={(shapeL + shapeR) / 2}
                        cy={cy}
                        r={dotR + 4}
                        fill="none"
                        stroke={fill}
                        strokeWidth={2}
                        opacity={0.5}
                      />
                    ))}
                  {kind === 'bar' ? (
                    <>
                      <rect
                        x={shapeL}
                        y={cy - barH / 2}
                        width={shapeR - shapeL}
                        height={barH}
                        rx={lane ? 2 * S : barH / 2}
                        fill={fill}
                        opacity={0.85}
                      />
                      {/* 進行中：右端蓋一層白色淡出，表示「還沒結束」 */}
                      {ongoing && (
                        <rect
                          x={Math.max(shapeL, shapeR - 32)}
                          y={cy - barH / 2 - 1}
                          width={Math.min(32, shapeR - shapeL)}
                          height={barH + 2}
                          fill="url(#hst-ongoing-fade)"
                        />
                      )}
                    </>
                  ) : estimate ? (
                    /* 推估位置：虛線空心圓點，明確標示「這不是真實日期」 */
                    <circle
                      cx={(shapeL + shapeR) / 2}
                      cy={cy}
                      r={dotR}
                      fill={C.halo}
                      stroke={fill}
                      strokeWidth={2}
                      strokeDasharray="3 2.5"
                    />
                  ) : (
                    <circle cx={(shapeL + shapeR) / 2} cy={cy} r={dotR} fill={fill} />
                  )}
                  <text
                    x={labelSide === 'right' ? shapeR + 6 * S : shapeL - 6 * S}
                    y={cy + 4 * S}
                    textAnchor={labelSide === 'right' ? 'start' : 'end'}
                    fontSize={M.font}
                    fontWeight={isKey ? 700 : 400}
                    fill={isKey ? C.ink : C.inkEvent}
                  >
                    {dateLabel && <tspan fill={C.inkFaint} fontWeight={400}>{dateLabel} </tspan>}
                    {text}
                  </text>
                </g>
              )
            })}
          </g>
        ))}

        {/* 亮起的關係說明標籤：畫在最上層，白底圓角框，不與事件文字交疊 */}
        {showRelations && (
          <g pointerEvents="none">
            {layout.relationLines
              .filter(
                ({ fromKey, toKey }) =>
                  selectedKey === fromKey ||
                  selectedKey === toKey ||
                  hoveredKey === fromKey ||
                  hoveredKey === toKey,
              )
              .map(({ id, label, labelW, labelX, labelY }) => (
                <g key={`${id}-label`}>
                  <rect
                    x={labelX - labelW / 2}
                    y={labelY - 10 * S}
                    width={labelW}
                    height={20 * S}
                    rx={10 * S}
                    fill={C.warnBg}
                    stroke={C.warnLine}
                    strokeWidth={1}
                  />
                  <text
                    x={labelX}
                    y={labelY + 4 * S}
                    textAnchor="middle"
                    fontSize={F.date}
                    fontWeight={600}
                    fill={C.warn}
                  >
                    {label}
                  </text>
                </g>
              ))}
          </g>
        )}

        {/* 泳道外觀：左側滿高色塊寫軸線名。畫在事件之後，
            被平移到左邊界外的事件圖形會被色塊蓋住，不會露在軸線名上 */}
        {lane &&
          layout.bands.map(({ key, laneLabel, color, bandTop, bandH }) => {
            if (!laneLabel) return null
            const ink = textOnColor(color, C)
            let ty = bandTop + 10 * S
            return (
              <g key={`${key}-lane`}>
                <rect x={0} y={bandTop} width={plotL - 4 * S} height={bandH} fill={color} />
                {laneLabel.head.map((line, i) => {
                  ty += F.date * 1.4
                  return (
                    <text key={`h${i}`} x={10 * S} y={ty - F.date * 0.3} fontSize={F.date} fill={ink} opacity={0.85}>
                      {line}
                    </text>
                  )
                })}
                {laneLabel.tail.map((line, i) => {
                  ty += F.track * 1.4
                  return (
                    <text key={`t${i}`} x={10 * S} y={ty - F.track * 0.3} fontSize={F.track} fontWeight={700} fill={ink}>
                      {line}
                    </text>
                  )
                })}
              </g>
            )
          })}

        {/* hover 某條軸線時浮現「跳到最早／最新事件」按鈕（⇤／⇥），平常完全不佔畫面 */}
        {layout.bands
          .filter((bd) => bd.key === hoveredBand && bd.firstU != null)
          .map((bd) => {
            const by = bd.bandTop + 4
            const btn = (bx: number, glyph: string, u: number, tip: string) => (
              <g
                key={glyph}
                className="cursor-pointer"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  jumpToU(u)
                }}
              >
                <title>{tip}</title>
                <rect x={bx} y={by} width={26 * S} height={20 * S} rx={5 * S} fill={C.bg} stroke={C.axis} />
                <text x={bx + 13 * S} y={by + 14 * S} textAnchor="middle" fontSize={F.track} fill={C.inkSoft}>
                  {glyph}
                </text>
              </g>
            )
            return (
              <g key={`${bd.key}-nav`}>
                {btn(width - 62 * S, '⇤', bd.firstU!, '跳到這條軸線最早的事件')}
                {btn(width - 32 * S, '⇥', bd.lastU!, '跳到這條軸線最新的事件')}
              </g>
            )
          })}
        {/* 標註框畫在最上層 */}
        {calloutLayout && <CalloutLayer placed={calloutLayout.placed} theme={T} />}
        </g>
        {/* 匯出圖片底部：左側註記（例如只列了關鍵事件）與出處小字（太長會換行，不會被切掉） */}
        {exportMode && (
          <ExportFooter
            footer={exportMode.footer}
            note={exportMode.note}
            width={width}
            height={exportMode.height}
            noteX={12 * S}
            theme={T}
          />
        )}
      </svg>
  )

  // 匯出模式：固定尺寸、不捲動、不互動
  if (exportMode) {
    return (
      <div style={{ width, height: exportMode.height, overflow: 'hidden', background: C.bg }}>
        {svgEl}
      </div>
    )
  }

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full select-none overflow-y-auto">
        {width > 0 && svgEl}
      </div>
      {selectionDir && (
        <button
          type="button"
          onClick={returnToSelection}
          className={
            'absolute top-1/2 z-10 flex -translate-y-1/2 items-center gap-1 rounded-full border border-amber-300 bg-amber-50/95 px-3 py-1.5 text-xs font-medium text-amber-800 shadow-md hover:bg-amber-100 ' +
            (selectionDir === 'left' ? 'left-3' : 'right-3')
          }
        >
          {selectionDir === 'left' ? '← 回到選取的事件' : '回到選取的事件 →'}
        </button>
      )}
    </div>
  )
}
