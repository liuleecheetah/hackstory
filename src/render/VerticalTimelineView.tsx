// render 層：直式時間軸檢視
//
// 時間由上往下流（上＝早，下＝晚），多條軸線變成左右並排的欄。
// 文字仍然是橫的——這是直式的重點：每個事件天然擁有一整行寬度，適合閱讀。
//
// 這是「閱讀與輸出」模式：整條軸一次攤開，往下捲動讀完。
// 捲動＝平移時間（用瀏覽器原生捲動，手機才有慣性與回彈）；
// Ctrl／⌘＋滾輪、觸控板捏合＝以游標為錨點縮放，刻意與橫式的「滾輪＝縮放」不同。
//
// 排版的數學都在 verticalLayout.ts，資料準備都在 timelineData.ts——
// 這個檔案只負責「畫出來」。

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { sameDocumentRelations } from '../core'
import type { CalloutSpec } from './callouts'
import { placeCallouts } from './callouts'
import { CalloutLayer, calloutMetrics } from './CalloutLayer'
import { ExportFooter, exportFooterHeight } from './ExportFooter'
import { ExportHeader, layoutExportHeader } from './ExportHeader'
import { formatSkipped } from './gaps'
import { OrdinalBadge, ordinalBadgeWidth } from './OrdinalBadge'
import { layoutPeriods, periodSources } from './periods'
import { ordinalTicks, ORDINAL_STEP } from './ordinal'
import { estimateTextWidth } from './layout'
import { buildBands, buildTimelineBase, RELATION_LABELS, relationDash, relationTypesIn } from './timelineData'
import type { PreparedBand, PreparedEvent } from './timelineData'
import type { RenderTheme } from './theme'
import { THEMES } from './theme'
import type { DateParts } from './timeScale'
import { formatRangeLabel, formatTick, getTicks } from './timeScale'
import type {
  EventSelection,
  NewEventDraft,
  ScaleMode,
  ScaleRequest,
  TimelineSource,
} from './types'
import type { VerticalColumn } from './verticalLayout'
import {
  centerColumnRects,
  columnRects,
  fitContentHeight,
  fitText,
  MIN_COL_W as BASE_MIN_COL_W,
  pickVerticalMode,
  RULER_W as BASE_RULER_W,
  shapeGutter,
  stackLabels,
  verticalLanes,
  visibleURange,
} from './verticalLayout'

/**
 * 匯出模式：固定尺寸、不互動、上下加標題與出處。
 * 由 exportSvg.tsx 離屏渲染時使用——**畫面與匯出圖走同一段繪製程式**，
 * 才不會出現「看到的」跟「存下來的」長不一樣。
 */
export interface VerticalExportOptions {
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

interface Props {
  sources: TimelineSource[]
  /** 是否在事件標題前顯示日期（預設顯示） */
  showDates?: boolean
  /** 日期是否含年份（預設顯示） */
  showYears?: boolean
  /** 年、月、日分別控制（出圖用）；有給就取代上面兩個勾選 */
  dateParts?: DateParts
  /** 是否摺疊大段空白（SPEC display.collapseGaps），預設不摺疊 */
  collapseGaps?: boolean
  /**
   * 順序等距（只在出圖工作室）：事件依先後等距排列、不照時間比例。
   * 刻度改成每格寫年份、刻度尺畫成一段一段，圖的右上角固定標「非等比」
   */
  ordinal?: boolean
  /** 是否繪製事件關係線（SPEC 第 7 節 relations，預設顯示） */
  showRelations?: boolean
  /** 時間方向反過來：最新的在最上面（預設是最早的在上面） */
  reversed?: boolean
  /** 刻度尺移到畫面中央，軸線分左右兩側對照（需要兩條以上軸線） */
  centerAxis?: boolean
  /** 刻度尺的年份用大字（版型 B 雙向對照，只在匯出時） */
  bigYears?: boolean
  /** 主題：字級、尺寸、顏色（預設「螢幕」主題）。直式沒有精簡模式 */
  theme?: RenderTheme
  /** 標註框：挑出來加「標題＋摘要」說明的事件（只在匯出時畫） */
  callouts?: CalloutSpec[]
  /** ui 層下的指令：「切到某個尺度」 */
  scaleRequest?: ScaleRequest | null
  /** 縮放後回報目前落在哪個尺度，讓 ui 層的按鈕高亮 */
  onScaleModeChange?: (mode: ScaleMode) => void
  /** 目前被選取的事件（組合鍵），該事件會畫上光環 */
  selectedKey?: string | null
  /** 點事件 → 回報選取；點空白處 → 回報 null */
  onEventSelect?: (selection: EventSelection | null) => void
  /**
   * 在欄內空白處點兩下 → 回報新增事件的草稿資訊（未提供時停用，例如嵌入模式）。
   * 單欄合流時停用：那時候看不出使用者想加到哪一條軸線，猜錯比不做更糟。
   */
  onEventCreate?: (draft: NewEventDraft) => void
  /** 回報目前的可視時間範圍（壓縮座標 u），讓 ui 層的比例匯出做到所見即所得 */
  onDomainChange?: (domain: [number, number]) => void
  /** 受控的可視範圍（匯出時由外部指定；畫面上的檢視不傳） */
  domain?: [number, number]
  /** 有值 = 匯出模式（固定尺寸、不互動） */
  exportMode?: VerticalExportOptions
  // 之後會補上 onEventCreate（直式編輯）——現在不留半成品的程式碼，屆時再加。
}

const LANE_COUNT = 4 // 副車道最多幾層，再多就會把標題的寬度吃光

/**
 * 直式的各種尺寸，全部由主題衍生：字級與圓點直接取主題的值，
 * 其餘間距是「主題倍率 1 時的像素 × 倍率」——字放大，格子也跟著放大。
 * 螢幕主題（倍率 1）算出來的數字與改版前寫死的常數完全相同。
 */
function verticalSizes(T: RenderTheme) {
  const S = T.scale
  return {
    HEADER_H: 34 * S, // 頂部欄標題列高度（捲動時固定在上緣）
    TOP_PAD: 18 * S,
    BOTTOM_PAD: 32 * S,
    COL_PAD: 10 * S, // 欄內左右留白
    // 副車道每往右錯開多少。要比最大的圓點（重點事件直徑 15）再寬一點，
    // 錯開後的圓點才不會擠成一團
    LANE_STEP: 16 * S,
    LABEL_H: 18 * S, // 一行標題佔的高度
    FONT: T.font.event,
    DOT_R: T.dotR,
    KEY_DOT_R: T.keyDotR,
    BAR_W: T.barH,
    KEY_BAR_W: T.keyBarH,
    MIN_BAR_H: 10 * S, // 很短的區間事件至少畫這麼長，才看得見
    TITLE_H: 42 * S, // 匯出圖片頂部的標題列
    TITLE_SUB_H: 64 * S, // 有副標時的標題列
    FOOTER_H: 22 * S, // 匯出圖片底部的出處小字
    ROW_H: 96 * S, // 一個事件「舒服讀」大概需要的高度（決定整條軸最長拉到多長）
    // 標題最多可以離自己的時間位置多遠。超過就不畫標題，只留圓點——
    // 否則讀者會對不上左邊的年份刻度，以為那件事發生在別的年代
    MAX_DRIFT: 26 * S,
    LABEL_GAP: 8 * S, // 圖形右緣到標題的距離
    RULER_W: BASE_RULER_W * S, // 刻度尺寬度：年份字放大，尺也要跟著變寬
    MIN_COL_W: BASE_MIN_COL_W * S,
  }
}

const DAY = 86_400_000
/** 各尺度按鈕對應的可視時間跨度（與橫式共用同一組數字，切換方向時感受一致） */
const SCALE_SPANS: Record<Exclude<ScaleMode, 'year'>, number> = {
  day: 14 * DAY,
  week: 91 * DAY,
  month: 730 * DAY,
}
// 軸最長可以拉到多少像素。放大＝把軸拉長，不是把時間範圍縮小——
// 這樣不管放多大，往上捲都還是回得到最早的年份
const MAX_CONTENT_H = 400_000

/** 一個排好位置、可以直接畫的事件 */
interface PlacedEvent {
  key: string
  pe: PreparedEvent
  band: PreparedBand
  isBar: boolean
  /** 圖形左緣 x（已含副車道位移） */
  x: number
  yTop: number
  yBot: number
  shapeW: number
  labelX: number
  /** 標題實際被畫在哪一行（可能被往下擠）。null = 排不下，這一列只畫圓點 */
  labelY: number | null
  /** 圖形連到標題的引線；就在旁邊、不需要引線時為 null */
  leader: string | null
  /** 這一列感應區的左右界（＝所屬欄的邊界）。不能超出自己的欄，否則會搶到隔壁欄的點擊 */
  rowLeft: number
  rowRight: number
  /** 鏡像欄（貼著中央刻度尺、文字往左長）：文字要靠右對齊 */
  mirrored: boolean
  dateLabel: string
  title: string
  /** 單欄合流模式才有：軸線縮寫 */
  abbr: string | null
  abbrX: number
}

export function VerticalTimelineView({
  sources,
  showDates = true,
  showYears = true,
  dateParts,
  collapseGaps = false,
  ordinal = false,
  showRelations = true,
  reversed = false,
  centerAxis = false,
  bigYears = false,
  theme = THEMES.screen,
  callouts,
  scaleRequest,
  onScaleModeChange,
  selectedKey,
  onEventSelect,
  onEventCreate,
  onDomainChange,
  domain: domainProp,
  exportMode,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  // 尺寸與顏色全部來自主題
  const T = theme
  const big = bigYears && !!exportMode
  const C = T.colors
  const F = T.font
  const S = T.scale
  const {
    HEADER_H,
    TOP_PAD,
    BOTTOM_PAD,
    COL_PAD,
    LANE_STEP,
    LABEL_H,
    FONT,
    DOT_R,
    KEY_DOT_R,
    BAR_W,
    KEY_BAR_W,
    MIN_BAR_H,
    TITLE_H: TITLE_ONLY_H,
    TITLE_SUB_H,
    FOOTER_H: FOOTER_BASE_H,
    ROW_H,
    MAX_DRIFT,
    LABEL_GAP,
    RULER_W,
    MIN_COL_W,
  } = useMemo(() => verticalSizes(T), [T])
  // 標題、副標太長時各自換成最多兩行，標題列跟著加高（順序等距時標題讓出右上角的「非等比」標示）
  const header = exportMode
    ? layoutExportHeader(
        exportMode.title,
        exportMode.subtitle,
        exportMode.width,
        T,
        ordinal ? ordinalBadgeWidth(T, exportMode.width / 2) + 12 * S : 0,
      )
    : null
  const TITLE_H = header ? header.height : exportMode?.subtitle ? TITLE_SUB_H : TITLE_ONLY_H
  // 有底部註記時（例如「僅列關鍵事件」）多留一行，註記放在出處行上面
  // 出圖時圖上有關係線，就在底部加圖例，讀者才看得懂每種線的意思
  const relLegend = useMemo(
    () => (exportMode && showRelations ? relationTypesIn(sources) : []),
    [exportMode, showRelations, sources],
  )
  const FOOTER_H = exportMode
    ? exportFooterHeight(FOOTER_BASE_H, exportMode.footer, exportMode.note, exportMode.width, T, relLegend)
    : FOOTER_BASE_H
  // 欄標題列：捲動時用 transform 貼回上緣（直接改 DOM，避免每個捲動事件都重繪整張圖）
  const headerRef = useRef<SVGGElement>(null)
  // 0 = 還沒量到容器寬度。量到之前不畫，否則手機上會先用預設值畫成多欄再跳成單欄
  const [measuredWidth, setMeasuredWidth] = useState(0)
  const width = exportMode?.width ?? measuredWidth
  // 有標註框時（只在匯出），欄位往左縮，右側留一條標註專用欄——框絕不蓋到事件文字。
  // 但欄位若因此窄到標題讀不下去，就不留（事件本身比標註重要），放不下的標註改為省略並提醒
  const CALLOUT_BOX_W = 160 // 直式的標註框窄一點，少佔欄寬
  const wantStrip = !!exportMode && !!callouts && callouts.length > 0
  const stripW = calloutMetrics(T, 0, CALLOUT_BOX_W).boxW + 16 * S
  const bandCount = Math.max(1, sources.reduce((n, s) => n + s.doc.tracks.length, 0))
  // 左右對照（刻度尺在中間）：左側軸線的標註放左邊、右側的放右邊，引線才不會穿過刻度尺——
  // 所以兩側各留一條標註欄
  const bothSides = centerAxis && bandCount >= 2
  const calloutStripW =
    wantStrip && (width - stripW * (bothSides ? 2 : 1) - RULER_W) / bandCount >= MIN_COL_W ? stripW : 0
  const leftStripW = bothSides ? calloutStripW : 0
  const colAreaW = width - calloutStripW
  // 「回到選取的事件」浮動鈕的方向（事件捲出畫面時才出現）
  const [returnDir, setReturnDir] = useState<'up' | 'down' | null>(null)
  // 滑鼠懸停的事件：不用點擊，關係線就會先亮起來（與橫式同語彙）
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)

  // 資料準備與橫式共用同一份（timelineData），所以兩種方向不可能畫出不同的事件
  const base = useMemo(
    () => buildTimelineBase(sources, collapseGaps, ordinal),
    [sources, collapseGaps, ordinal],
  )
  const bands = useMemo(
    () => buildBands(sources, base, { showDates, showYears, dateParts }, T.palette),
    [sources, base, showDates, showYears, dateParts, T.palette],
  )
  const { warp, initialDomain, anchorTimes } = base

  // 時期底色（SPEC 7.5）：第一份有時期的圖層畫滿版淡色底，其他圖層只在刻度尺旁畫細條
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

  // 放大倍率：1 = 整條軸剛好是一頁的「舒服閱讀長度」，2 = 軸拉成兩倍長。
  //
  // **軸涵蓋的時間範圍永遠是整條時間軸**，放大只是把它拉長。
  // （早期版本是放大就把範圍縮小，結果捲動範圍跟著縮小，
  //   放大後就捲不回前面的年份了。）
  const [zoom, setZoom] = useState(1)
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom

  // 匯出時範圍由外部指定；畫面上永遠是整條軸
  const axisDomain = exportMode ? (domainProp ?? initialDomain) : initialDomain

  // 目前被選取事件的位置（壓縮座標 u）
  const selectedU = useMemo(() => {
    if (!selectedKey) return null
    const t = anchorTimes.get(selectedKey)
    return t != null ? warp.toU(t) : null
  }, [selectedKey, anchorTimes, warp])

  // 量測容器寬度：欄夠不夠寬決定要多欄並排還是單欄合流
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

  // 匯出時一律多欄並排（寬度是使用者指定的，不做單欄合流的退場）
  const mode = exportMode ? 'columns' : pickVerticalMode(width, bands.length, RULER_W, MIN_COL_W)

  // 單欄合流時每列開頭的軸線縮寫：同一份文件有多條軸就用軸線名，否則用文件名
  const abbrOf = useMemo(() => {
    const perDoc = new Map<string, number>()
    for (const b of bands) perDoc.set(b.docTitle, (perDoc.get(b.docTitle) ?? 0) + 1)
    const map = new Map<string, string>()
    for (const b of bands) {
      const name = (perDoc.get(b.docTitle) ?? 0) > 1 ? b.trackTitle : b.docTitle
      map.set(b.key, [...name].slice(0, 4).join(''))
    }
    return map
  }, [bands])

  const layout = useMemo(() => {
    const [d0, d1] = axisDomain
    const span = d1 - d0 || 1
    // 匯出模式在最上面多一列標題、最下面多一行出處
    const headerTop = exportMode ? TITLE_H : 0
    const axisTop = headerTop + HEADER_H + TOP_PAD

    // 只排目前時間範圍內的事件（沒有縮放時就是全部）
    const visibleBands = bands.map((b) => ({
      band: b,
      events: b.events.filter((pe) => {
        const uEnd = pe.kind === 'bar' ? warp.toU(pe.tEnd) : pe.u
        return uEnd >= d0 && pe.u <= d1
      }),
    }))

    // 內容高度：事件擠在同一段時間時就把軸拉長，
    // 讓標題不必被擠得離自己的時間位置太遠（一次攤開，用捲動讀完）
    const norm = (u: number) => Math.min(1, Math.max(0, (u - d0) / span))
    const groups =
      mode === 'merged'
        ? [visibleBands.flatMap((b) => b.events.map((e) => norm(e.u))).sort((x, z) => x - z)]
        : visibleBands.map((b) => b.events.map((e) => norm(e.u)))
    // 軸再怎麼拉長，也不超過「每個事件一行」的長度——否則事件全擠在
    // 某十年的時間軸，會被拉成幾千像素的空白，讀者只是在捲空氣
    const rowCount = groups.reduce((n, g) => Math.max(n, g.length), 0)
    // 基準長度：不放大時，整條軸「一次攤開、舒服讀完」需要多長
    const baseH = fitContentHeight(groups, {
      maxH: Math.min(12_000, Math.max(520, rowCount * ROW_H)),
    })
    // 匯出：高度是使用者選的比例決定的，軸只能塞進剩下的空間
    const contentH = exportMode
      ? Math.max(80, exportMode.height - axisTop - FOOTER_H - BOTTOM_PAD)
      : Math.min(MAX_CONTENT_H, baseH * zoom)
    /** 放大倍率的上限（軸再長瀏覽器就吃不消了） */
    const maxZoom = Math.max(1, MAX_CONTENT_H / baseH)

    /**
     * 壓縮座標 u ↔ 畫面 y（縮放、置中、浮動鈕都靠這對換算）。
     * reversed = 最新的在最上面：把比例整個翻過來，其他排版程式一律只看畫面 y，不必再管方向。
     */
    const frac = (u: number) => {
      const f = (u - d0) / span
      return reversed ? 1 - f : f
    }
    const yOfU = (u: number) => axisTop + frac(u) * contentH
    const uOfY = (yv: number) => {
      const f = (yv - axisTop) / (contentH || 1)
      return d0 + (reversed ? 1 - f : f) * span
    }
    /** 真實時間 → 畫面 y。跨出目前範圍的長條夾在軸的兩端，不會畫到天邊去 */
    const y = (t: number) =>
      Math.min(axisTop + contentH, Math.max(axisTop, yOfU(warp.toU(t))))

    /** 把一組事件排進一個矩形欄位裡 */
    const place = (
      entries: Array<{ band: PreparedBand; pe: PreparedEvent }>,
      rect: VerticalColumn,
      withAbbr: boolean,
    ): PlacedEvent[] => {
      const raw = entries
        .map(({ band, pe }) => {
          const isBar = pe.kind === 'bar'
          const yTop = y(pe.tStart)
          const yBot = isBar ? Math.max(y(pe.tEnd), yTop + MIN_BAR_H) : yTop
          return { band, pe, isBar, yTop, yBot }
        })
        .sort((a, b) => a.yTop - b.yTop)

      // 副車道：只處理「圖形」互相疊住的情形（同一天發生的兩個事件）
      const lanes = verticalLanes(
        raw.map((r) => ({
          top: r.isBar ? r.yTop : r.yTop - DOT_R,
          bottom: r.isBar ? r.yBot : r.yTop + DOT_R,
        })),
      )
      // 標題堆疊：圓點留在真實時間位置，標題往下擠開，兩者用細線連起來
      const naturalLabelYs = raw.map((r) => (r.isBar ? r.yTop + 12 * S : r.yTop + 4 * S))
      const labelYs = stackLabels(naturalLabelYs, LABEL_H, MAX_DRIFT)
      const right = rect.x + rect.w - COL_PAD

      // 超出可用層數時「繞回第 0 層」而不是全部壓在最後一層——
      // 壓在同一層會讓密集區的圓點疊成一坨，繞回去至少還是散開的
      // 出圖時欄可能很窄（對照版型一欄只有半張圖）：副車道最多只佔欄寬的一小段，
      // 否則錯開的圓點會把標題的寬度吃光，只剩一兩個字
      const laneCap = exportMode
        ? Math.max(1, Math.min(LANE_COUNT, Math.floor((rect.w * 0.15) / LANE_STEP) + 1))
        : LANE_COUNT
      const laneOf = (i: number) => lanes[i] % laneCap
      const widthOf = (r: (typeof raw)[number]) =>
        r.isBar
          ? r.pe.isKey
            ? KEY_BAR_W
            : BAR_W
          : (r.pe.isKey ? KEY_DOT_R : DOT_R) * 2

      // 圖形區與文字區分開：圖形（含錯開的副車道）佔左邊這麼寬，
      // 標題一律從它的右邊開始——圓點就再也壓不到隔壁事件的標題上
      const gutter = shapeGutter(
        raw.map((r, i) => ({ lane: laneOf(i), width: widthOf(r) })),
        LANE_STEP,
      )
      // 單欄合流的軸線縮寫也取一致寬度，整欄的標題才對得齊
      const abbrW = withAbbr
        ? raw.reduce(
            (m, r) => Math.max(m, estimateTextWidth(abbrOf.get(r.band.key) ?? '', F.footer)),
            0,
          ) + 6 * S
        : 0
      // 鏡像欄：圖形貼著欄的右緣（也就是中央刻度尺），標題往左邊長
      const mirrored = rect.mirrored
      const left = rect.x + COL_PAD
      const abbrX = mirrored
        ? rect.x + rect.w - COL_PAD - gutter - LABEL_GAP
        : left + gutter + LABEL_GAP
      const labelX = mirrored ? abbrX - abbrW : abbrX + abbrW
      const avail = mirrored ? labelX - left : right - labelX

      return raw.map((r, i) => {
        const x = mirrored
          ? rect.x + rect.w - COL_PAD - widthOf(r) - laneOf(i) * LANE_STEP
          : left + laneOf(i) * LANE_STEP
        const shapeW = widthOf(r)
        const abbr = withAbbr ? (abbrOf.get(r.band.key) ?? null) : null
        const labelY = labelYs[i]

        // 這一列排不下標題（只畫圓點），文字相關的計算全部跳過
        if (labelY === null) {
          return {
            key: `${r.band.sourceId}/${r.pe.ev.id}`,
            pe: r.pe,
            band: r.band,
            isBar: r.isBar,
            x,
            yTop: r.yTop,
            yBot: r.yBot,
            shapeW,
            labelX,
            labelY,
            leader: null,
            rowLeft: rect.x + 2,
            rowRight: rect.x + rect.w - 2,
            mirrored,
            dateLabel: '',
            title: '',
            abbr: null,
            abbrX,
          }
        }

        // 標題依剩餘寬度截斷；連日期都擠不下時，寧可捨棄日期也要留住標題
        let dateLabel = r.pe.dateLabel
        const prefixW = dateLabel ? estimateTextWidth(`${dateLabel} `, FONT) : 0
        let title = fitText(r.pe.ev.title, avail - prefixW, FONT)
        if (title === '' && dateLabel) {
          dateLabel = ''
          title = fitText(r.pe.ev.title, avail, FONT)
        }

        // 標題被擠開、或圖形離標題有一段距離時，畫一條細引線把兩者接起來
        const shapeEdge = mirrored ? x : x + shapeW
        const drift = labelY - naturalLabelYs[i]
        const gap = mirrored ? shapeEdge - labelX : labelX - shapeEdge
        const leader =
          drift > 3 || gap > 18
            ? mirrored
              ? `M ${shapeEdge - 3} ${r.yTop} H ${labelX + 10} V ${labelY - 4} H ${labelX + 3}`
              : `M ${shapeEdge + 3} ${r.yTop} H ${labelX - 10} V ${labelY - 4} H ${labelX - 3}`
            : null

        return {
          key: `${r.band.sourceId}/${r.pe.ev.id}`,
          pe: r.pe,
          band: r.band,
          isBar: r.isBar,
          x,
          yTop: r.yTop,
          yBot: r.yBot,
          shapeW,
          labelX,
          labelY,
          leader,
          rowLeft: rect.x + 2,
          rowRight: rect.x + rect.w - 2,
          mirrored,
          dateLabel,
          title,
          abbr,
          abbrX,
        }
      })
    }

    // 對照模式：刻度尺移到中央、軸線分左右。單軸或單欄合流時沒有對照對象，維持一般排法
    const useCenter = centerAxis && mode === 'columns' && visibleBands.length >= 2
    // 左邊留了標註欄時，整組欄位往右移一條欄寬
    const center = useCenter
      ? (() => {
          const c = centerColumnRects(colAreaW - leftStripW, visibleBands.length, RULER_W)
          return {
            rulerX: c.rulerX + leftStripW,
            columns: c.columns.map((col) => ({ ...col, x: col.x + leftStripW })),
          }
        })()
      : null
    const rulerX = center ? center.rulerX : 0
    const rects = center
      ? center.columns
      : mode === 'merged'
        ? [{ x: RULER_W, w: Math.max(0, colAreaW - RULER_W), mirrored: false }]
        : columnRects(colAreaW, visibleBands.length, RULER_W)

    const layoutColumns =
      mode === 'merged'
        ? [
            {
              rect: rects[0],
              band: null as PreparedBand | null,
              items: place(
                visibleBands.flatMap(({ band, events }) => events.map((pe) => ({ band, pe }))),
                rects[0],
                true,
              ),
            },
          ]
        : visibleBands.map(({ band, events }, i) => ({
            rect: rects[i],
            band,
            items: place(
              events.map((pe) => ({ band, pe })),
              rects[i],
              false,
            ),
          }))
    // 這一欄有幾件事件擠到畫不下標題（只剩圓點）——要讓使用者知道，不能默默藏起來
    const hiddenOf = (items: PlacedEvent[]) => items.filter((it) => it.labelY === null).length

    // 每個事件圖形的中心點，供關係線定位
    const anchors = new Map<string, { x: number; y: number }>()
    for (const c of layoutColumns) {
      for (const it of c.items) {
        anchors.set(it.key, {
          x: it.x + it.shapeW / 2,
          y: it.isBar ? (it.yTop + it.yBot) / 2 : it.yTop,
        })
      }
    }

    // 關係線：只連同一份文件內、兩端都畫得出來的事件。
    // 跨文件關係（fromDoc／toDoc）在這裡濾掉——事件 id 只在文件內唯一，
    // 若不明確略過，外部 id 剛好與本文件事件同名時會畫出一條錯誤的線。
    //
    // 幾何是橫式那條曲線的鏡像：橫式讓曲線往上下鼓、共用一個 midY；
    // 直式時間往下流，改成往左右鼓、共用一個 midX。
    const relationLines = sources.flatMap((source) =>
      sameDocumentRelations(source.doc.relations).flatMap((rel, i) => {
        const fromKey = `${source.id}/${rel.from}`
        const toKey = `${source.id}/${rel.to}`
        const from = anchors.get(fromKey)
        const to = anchors.get(toKey)
        if (!from || !to) return []

        // 同一欄（單欄合流時全部都是）：曲線往右鼓出去繞過中間的事件。
        // 鼓多遠看兩件事隔多久——時間跨得愈遠的線繞得愈外面，
        // 好幾條線才不會疊成一束看不出誰是誰
        const sameColumn = Math.abs(from.x - to.x) < 12
        const bow = Math.min(96, 32 + Math.abs(to.y - from.y) * 0.12)
        const midX = sameColumn ? Math.max(from.x, to.x) + bow : (from.x + to.x) / 2
        const d = sameColumn
          ? `M ${from.x + 8} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x + 8} ${to.y}`
          : `M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}`

        const label = rel.label ?? RELATION_LABELS[rel.type] ?? rel.type
        // 標籤底框的尺寸與位置（夾在畫面內，不被切出去）
        const labelW = estimateTextWidth(label, F.date) + 18 * S
        const labelX = Math.min(Math.max(midX, labelW / 2 + 4), width - labelW / 2 - 4)
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
            labelY: (from.y + to.y) / 2,
          },
        ]
      }),
    )

    // 事件擠在最下面時，標題會被堆到軸的盡頭之外——SVG 要留得下它們
    const lowest = layoutColumns.reduce(
      (m, c) => c.items.reduce((n, it) => Math.max(n, it.labelY ?? 0, it.yBot), m),
      0,
    )
    const totalH = exportMode
      ? exportMode.height
      : Math.max(axisTop + contentH + BOTTOM_PAD, lowest + BOTTOM_PAD)
    // 匯出時尺寸是固定的，事件太多就會有標題排不下（只剩圓點）——
    // 回報件數給對話框，讓它提醒使用者先縮放到較短的期間
    const hiddenTotal = layoutColumns.reduce((n, c) => n + hiddenOf(c.items), 0)
    // 欄太窄，中文標題幾乎只剩省略號——同樣提醒使用者
    const narrowColumns =
      layoutColumns.length > 0 &&
      (colAreaW - leftStripW - RULER_W) / layoutColumns.length < MIN_COL_W

    // 刻度：扣掉被摺疊的空白，每段密集區依自己佔的高度各自產生刻度
    const tView: [number, number] = [warp.toT(d0), warp.toT(d1)]
    const denseRanges: Array<[number, number]> = []
    let cursor = tView[0]
    for (const g of warp.gaps) {
      if (g.tEnd <= tView[0] || g.tStart >= tView[1]) continue
      if (g.tStart > cursor) denseRanges.push([cursor, g.tStart])
      cursor = Math.max(cursor, g.tEnd)
    }
    if (cursor < tView[1]) denseRanges.push([cursor, tView[1]])
    const regularTicks = denseRanges.flatMap(([x, z]) => {
      const px = ((warp.toU(z) - warp.toU(x)) / span) * contentH
      if (px < 50) return []
      return getTicks([x, z], px).filter((d) => d.getTime() >= x && d.getTime() <= z)
    })
    // 順序等距：不畫規律刻度，每一格（事件的時間點）一條格線；年份寫在格子上，太擠就跳過
    const slots = warp.ordinalSlots
    const inAxis = (yv: number) => yv >= axisTop - 0.5 && yv <= axisTop + contentH + 0.5
    const slotYs = slots ? slots.map((t) => yOfU(warp.toU(t))).filter(inAxis) : []
    const slotPx = (ORDINAL_STEP / span) * contentH
    const ticks: Array<{ y: number; label: string }> = slots
      ? ordinalTicks(slots, (t) => yOfU(warp.toU(t)), (big ? F.title : F.date) * 1.6)
          .filter((m) => inAxis(m.pos))
          .map((m) => ({ y: m.pos, label: m.label }))
      : regularTicks
          .map((d) => ({ y: y(d.getTime()), label: formatTick(d) }))
          // 大年份（版型 B）：字大，摺疊處兩側的刻度容易擠在一起——太擠的就不寫
          .reduce<Array<{ y: number; label: string }>>((kept, m) => {
            const prev = kept[kept.length - 1]
            if (!big || !prev || Math.abs(m.y - prev.y) >= F.title * 1.5) kept.push(m)
            return kept
          }, [])
    // 沒寫年份的格子也要有格線
    const extraGridYs = slots ? slotYs.filter((yv) => !ticks.some((m) => m.y === yv)) : []

    return {
      totalH,
      headerTop,
      axisTop,
      contentH,
      baseH,
      maxZoom,
      axisDomain,
      rulerX,
      relationLines,
      columns: layoutColumns.map((c) => ({ ...c, hidden: hiddenOf(c.items) })),
      ticks,
      extraGridYs,
      slotYs,
      slotPx,
      y,
      yOfU,
      uOfY,
      tView,
      hiddenTotal,
      narrowColumns,
      anchors,
    }
  }, [bands, sources, mode, width, colAreaW, warp, axisDomain, zoom, abbrOf, exportMode, reversed, centerAxis, T, big, leftStripW])

  // 版面隨時可能重算（縮放、改欄數），互動要用「最新的一份」換算座標
  const layoutRef = useRef(layout)
  layoutRef.current = layout

  // 縮放或切尺度之後，要把某個時間點捲回指定的畫面位置——版面重算完才知道 y 在哪，
  // 所以先把要求記在這裡，等下面的 useLayoutEffect 執行
  const pendingScroll = useRef<{ u: number; offset: number | 'center' } | null>(null)

  // 回報「畫面上看得到多長的時間」，讓工具列的日／週／月／年高亮跟著放大倍率走
  const refreshScaleMode = () => {
    if (!onScaleModeChange || exportMode) return
    const el = containerRef.current
    const L = layoutRef.current
    if (!el || !L) return
    const fullSpan = L.axisDomain[1] - L.axisDomain[0] || 1
    const visible = (el.clientHeight / (L.contentH || 1)) * fullSpan
    onScaleModeChange(
      visible <= 30 * DAY
        ? 'day'
        : visible <= 200 * DAY
          ? 'week'
          : visible <= 1500 * DAY
            ? 'month'
            : 'year',
    )
  }

  // 回報目前「所在的那一段時間」給比例匯出用：範圍寬度依放大倍率，中心依捲動位置。
  // 捲動時會連續變化，所以停下來才回報一次，不然每一格都會重繪整個 App。
  const domainTimer = useRef<number | undefined>(undefined)
  const reportDomain = () => {
    if (!onDomainChange || exportMode) return
    window.clearTimeout(domainTimer.current)
    domainTimer.current = window.setTimeout(() => {
      const el = containerRef.current
      const L = layoutRef.current
      if (!L) return
      const [f0, f1] = L.axisDomain
      const fullSpan = f1 - f0 || 1
      const applied = Math.max(1, L.contentH / (L.baseH || 1))
      const span = Math.min(fullSpan, fullSpan / applied)
      const center = el ? L.uOfY(el.scrollTop + el.clientHeight / 2) : (f0 + f1) / 2
      const a = Math.min(f1 - span, Math.max(f0, center - span / 2))
      onDomainChange([a, a + span])
    }, 200)
  }
  useEffect(() => () => window.clearTimeout(domainTimer.current), [])

  /** 選取的事件捲出畫面時，往它的方向浮現一顆鈕；在畫面內就自動消失 */
  const refreshReturnDir = () => {
    const el = containerRef.current
    let dir: 'up' | 'down' | null = null
    if (el && selectedU != null) {
      const yv = layoutRef.current.yOfU(selectedU)
      if (yv < el.scrollTop + 24) dir = 'up'
      else if (yv > el.scrollTop + el.clientHeight - 24) dir = 'down'
    }
    setReturnDir((prev) => (prev === dir ? prev : dir))
  }

  // 版面重算後：先套用待處理的捲動要求，再把欄標題列貼回目前的捲動位置
  useLayoutEffect(() => {
    const el = containerRef.current
    const want = pendingScroll.current
    if (el && want) {
      const yv = layout.yOfU(want.u)
      el.scrollTop =
        want.offset === 'center' ? yv - el.clientHeight / 2 : yv - want.offset
      pendingScroll.current = null
    }
    headerRef.current?.setAttribute('transform', `translate(0 ${el?.scrollTop ?? 0})`)
    refreshReturnDir()
    refreshRangeLabel()
    refreshScaleMode()
    reportDomain()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, selectedU])

  // ui 層的尺度按鈕：日/週/月 → 限定顯示這麼長的一段時間；年 → 回到全貌。
  // 有選取事件時以「該事件」為中心（切尺度不再讓它跑出畫面），否則以目前看到的中間為準
  useEffect(() => {
    if (!scaleRequest) return
    const el = containerRef.current
    const L = layoutRef.current
    const center = selectedU ?? (el ? L.uOfY(el.scrollTop + el.clientHeight / 2) : null)
    if (scaleRequest.mode === 'year') {
      setZoom(1)
    } else {
      // 要讓「一個畫面的高度」剛好涵蓋這麼多時間，軸就得拉這麼長
      const viewH = el?.clientHeight ?? 600
      const fullSpan = L.axisDomain[1] - L.axisDomain[0] || 1
      const wanted = (viewH * fullSpan) / SCALE_SPANS[scaleRequest.mode] / L.baseH
      setZoom(Math.min(L.maxZoom, Math.max(1, wanted)))
    }
    if (center != null) pendingScroll.current = { u: center, offset: 'center' }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scaleRequest?.nonce])

  // Ctrl／⌘＋滾輪、觸控板捏合 = 以游標為錨點縮放。
  // 一般滾輪不攔截——交給瀏覽器原生捲動，那就是「上下平移時間」，手機也才有慣性。
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const box = containerRef.current
      if (!box) return
      const offset = e.clientY - box.getBoundingClientRect().top
      const anchor = layoutRef.current.uOfY(box.scrollTop + offset)
      // 往上滾（deltaY < 0）＝放大＝把軸拉長。倍率有下限 1：
      // 縮到看見整條軸就停住，再縮只是把事件擠成一團
      const next = zoomRef.current * Math.exp(-e.deltaY * 0.0015)
      setZoom(Math.min(layoutRef.current.maxZoom, Math.max(1, next)))
      // 縮放後讓游標底下的那個時間點留在原地，畫面才不會亂跳
      pendingScroll.current = { u: anchor, offset }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // width > 0 也要進依賴：量到寬度前 svg 還沒畫出來，那時掛不上監聽
  }, [sources.length > 0, width > 0]) // 空狀態沒有 svg，出現後要重掛監聽

  /** 把某個時間點捲到畫面中央 */
  const scrollToU = (u: number) => {
    const el = containerRef.current
    if (!el) return
    el.scrollTop = layoutRef.current.yOfU(u) - el.clientHeight / 2
    headerRef.current?.setAttribute('transform', `translate(0 ${el.scrollTop})`)
    refreshReturnDir()
    refreshRangeLabel()
  }

  if (sources.length === 0) {
    return (
      <div ref={containerRef} className="flex h-full items-center justify-center text-slate-400">
        沒有可顯示的圖層——請在左側面板勾選或載入 .hst.json 檔案
      </div>
    )
  }

  // 畫面上的檢視與匯出圖片共用這一段 SVG——「看到的」與「存下來的」保證一致
  // 左上角的範圍標籤要跟著捲動走——直式的整條軸比視窗高很多，
  // 顯示整條軸的範圍等於在說謊。直接改 DOM，不為了一行字重繪整張圖。
  const rangeLabelRef = useRef<SVGTextElement>(null)
  const refreshRangeLabel = () => {
    const el = containerRef.current
    const L = layoutRef.current
    const node = rangeLabelRef.current
    if (!node || !L) return
    // 匯出的圖沒有捲動，看到的就是整段
    const [u0, u1] = exportMode
      ? L.axisDomain
      : visibleURange(L.uOfY, el?.scrollTop ?? 0, el?.clientHeight ?? 0, L.axisDomain)
    node.textContent = formatRangeLabel([warp.toT(u0), warp.toT(u1)])
  }

  // 標註框（只在匯出時）：靠畫布右緣堆疊，找不到事件位置的算放不下
  const calloutLayout =
    exportMode && callouts && callouts.length > 0
      ? (() => {
          const top = layout.axisTop
          const bottom = layout.axisTop + layout.contentH
          const withAnchor = callouts.flatMap((c) => {
            const a = layout.anchors.get(c.key)
            return a && a.y >= top && a.y <= bottom ? [{ ...c, anchorX: a.x, anchorY: a.y }] : []
          })
          // 每個事件的圖形與標題佔的範圍：標註框盡量不蓋到
          const obstacles = layout.columns.flatMap((c) =>
            c.items.flatMap((it) => {
              const shape = { x: it.x, y: it.yTop - DOT_R, w: it.shapeW, h: Math.max(it.yBot - it.yTop, DOT_R * 2) }
              if (it.labelY === null) return [shape]
              const textW = estimateTextWidth(`${it.dateLabel} ${it.title}`, FONT)
              const label = {
                x: it.mirrored ? it.labelX - textW : it.labelX,
                y: it.labelY - LABEL_H * 0.8,
                w: textW,
                h: LABEL_H,
              }
              return [shape, label]
            }),
          )
          const metrics = calloutMetrics(T, width, CALLOUT_BOX_W)
          // 左右對照：刻度尺左邊的事件只在左半找位置、右邊的只在右半，引線不穿過刻度尺
          const result =
            layout.rulerX > 0
              ? (() => {
                  const mid = layout.rulerX + RULER_W / 2
                  const a = placeCallouts(
                    withAnchor.filter((c) => c.anchorX < mid),
                    { left: 4 * S, top, right: layout.rulerX - 4 * S, bottom },
                    'vertical',
                    metrics,
                    obstacles,
                  )
                  const b = placeCallouts(
                    withAnchor.filter((c) => c.anchorX >= mid),
                    { left: layout.rulerX + RULER_W + 4 * S, top, right: width - 6 * S, bottom },
                    'vertical',
                    metrics,
                    obstacles,
                  )
                  return { placed: [...a.placed, ...b.placed], dropped: [...a.dropped, ...b.dropped] }
                })()
              : placeCallouts(
                  withAnchor,
                  { left: 4 * S, top, right: width - 6 * S, bottom },
                  'vertical',
                  metrics,
                  obstacles,
                )
          const missing = callouts.filter((c) => !withAnchor.some((w) => w.key === c.key)).map((c) => c.key)
          return { placed: result.placed, dropped: [...result.dropped, ...missing] }
        })()
      : null

  const svgEl = (
    <svg
      ref={svgRef}
      id={exportMode?.svgId ?? 'hackstory-timeline-svg'}
      width={width}
      height={layout.totalH}
      className="block"
      style={{ background: C.bg }}
      data-hidden={layout.hiddenTotal}
      data-narrow-columns={layout.narrowColumns ? '1' : '0'}
      data-callouts-dropped={calloutLayout ? calloutLayout.dropped.join('|') : undefined}
      // 不擠、舒服讀完整條軸需要的高度（出圖工作室「自動長度」用）
      // 標題、副標兩行還放不下被截短了（出圖工作室在輸入框下提醒）
      data-title-truncated={header?.titleTruncated ? '1' : undefined}
      data-subtitle-truncated={header?.subtitleTruncated ? '1' : undefined}
      data-content-height={
        exportMode ? Math.ceil(layout.axisTop + layout.baseH + FOOTER_H + BOTTOM_PAD) : undefined
      }
      onClick={exportMode ? undefined : () => onEventSelect?.(null)}
      onDoubleClick={
        exportMode
          ? undefined
          : (e) => {
              // 在欄內空白處點兩下 → 以該位置的時間與那一欄的軸線開「新增事件」。
              // 單欄合流時分不出是哪條軸線，直接不做。
              if (!onEventCreate || mode === 'merged') return
              const rect = e.currentTarget.getBoundingClientRect()
              const xPix = e.clientX - rect.left
              const yPix = e.clientY - rect.top
              // 落在軸的頭尾之外就不算
              if (yPix < layout.axisTop || yPix > layout.axisTop + layout.contentH) return
              // 欄標題列是浮在內容上面的（捲動時貼著上緣），
              // 點在它上面時底下的時間不是使用者看到的那個，不能當成新增位置
              const scrollTop = containerRef.current?.scrollTop ?? 0
              if (yPix - scrollTop < HEADER_H) return
              const col = layout.columns.find(
                (c) => c.band && xPix >= c.rect.x && xPix <= c.rect.x + c.rect.w,
              )
              if (!col?.band) return
              const d = new Date(warp.toT(layout.uOfY(yPix)))
              onEventCreate({
                sourceId: col.band.sourceId,
                trackId: col.band.trackId,
                docTitle: col.band.docTitle,
                trackTitle: col.band.trackTitle,
                color: col.band.color,
                dateRaw: `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`,
                clientX: e.clientX,
                clientY: e.clientY,
              })
            }
      }
    >
          {/* 進行中事件下端的淡出漸層（方向由橫式的左右轉成上下） */}
          <defs>
            <linearGradient
              id="hst-ongoing-fade-v"
              x1="0"
              y1={reversed ? '1' : '0'}
              x2="0"
              y2={reversed ? '0' : '1'}
            >
              <stop offset="0" stopColor={C.halo} stopOpacity="0" />
              <stop offset="1" stopColor={C.halo} stopOpacity="1" />
            </linearGradient>
          </defs>

          {/* 時期底色：畫在最底層，橫跨所有欄。名稱寫在帶子起點的右上角（事件標題多半在左邊） */}
          {periodLayout.bands.map((pb) => {
            const top = layout.axisTop
            const bottom = layout.axisTop + layout.contentH
            const ya = layout.yOfU(pb.u0)
            const yb = layout.yOfU(pb.u1)
            const y0 = Math.max(top, Math.min(ya, yb))
            const y1 = Math.min(bottom, Math.max(ya, yb))
            if (y1 - y0 < 1) return null
            const left = layout.rulerX > 0 ? 0 : RULER_W
            // 帶子的「起點」：最早的在上面時是上緣，反過來時是下緣
            const startY = ya <= yb ? y0 : y1
            const labelY = ya <= yb ? startY + F.date + 3 * S : startY - 5 * S
            const name = y1 - y0 >= F.date + 6 * S ? fitText(pb.title, width - left - 12 * S, F.date) : ''
            return (
              <g key={pb.key} data-period={pb.key}>
                <title>{pb.description ? `${pb.title}：${pb.description}` : pb.title}</title>
                <rect x={left} y={y0} width={width - left} height={y1 - y0} fill={pb.fill} opacity={pb.opacity} />
                {name && (
                  <text
                    x={width - 6 * S}
                    y={labelY}
                    textAnchor="end"
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

          {/* 欄底色與左側色條 */}
          {layout.columns.map(({ rect, band }, i) => (
            <g key={band ? band.key : `merged-${i}`}>
              {band && (
                <rect
                  x={rect.x}
                  y={HEADER_H}
                  width={rect.w}
                  height={layout.totalH - HEADER_H}
                  fill={band.color}
                  opacity={0.04}
                />
              )}
              {band && (
                <rect x={rect.x} y={HEADER_H} width={2} height={layout.totalH - HEADER_H} fill={band.color} />
              )}
            </g>
          ))}

          {/* 橫線格線與刻度文字。刻度尺可能在最左邊，也可能在畫面正中央（對照模式） */}
          {layout.ticks.map(({ y: yv, label }, i) => {
            return (
              <g key={`tick-${i}`}>
                {/* 格線貫穿全寬；中央刻度尺時左右兩側都要有 */}
                <line
                  x1={layout.rulerX > 0 ? 0 : RULER_W}
                  x2={width}
                  y1={yv}
                  y2={yv}
                  stroke={C.grid}
                  strokeWidth={1}
                />
                <text
                  x={layout.rulerX + RULER_W / 2}
                  y={yv + (big ? F.title * 0.36 : 4 * S)}
                  textAnchor="middle"
                  fontSize={big ? F.title : F.date}
                  fontWeight={big ? 700 : undefined}
                  fill={big ? C.ink : C.inkMuted}
                >
                  {label}
                </text>
              </g>
            )
          })}
          {layout.extraGridYs.map((yv, i) => (
            <line
              key={`grid-${i}`}
              x1={layout.rulerX > 0 ? 0 : RULER_W}
              x2={width}
              y1={yv}
              y2={yv}
              stroke={C.grid}
              strokeWidth={1}
            />
          ))}
          {/* 其他圖層的時期：刻度尺右緣的細條（圖層色），滑鼠移上去看名稱 */}
          {periodLayout.strips.map((strip) =>
            strip.bands.map((pb) => {
              const ya = layout.yOfU(pb.u0)
              const yb = layout.yOfU(pb.u1)
              const y0 = Math.max(layout.axisTop, Math.min(ya, yb))
              const y1 = Math.min(layout.axisTop + layout.contentH, Math.max(ya, yb))
              if (y1 - y0 < 1) return null
              return (
                <rect
                  key={pb.key}
                  x={layout.rulerX + RULER_W - (strip.row + 1) * 4 * S}
                  y={y0}
                  width={3 * S}
                  height={y1 - y0}
                  fill={strip.color}
                  opacity={0.7}
                >
                  <title>{pb.description ? `${pb.title}：${pb.description}` : pb.title}</title>
                </rect>
              )
            }),
          )}

          {/* 刻度尺的邊界線：置中時兩側都畫，才看得出這是一根共用的時間軸 */}
          <line
            x1={layout.rulerX}
            x2={layout.rulerX}
            y1={HEADER_H}
            y2={layout.totalH}
            stroke={C.grid}
          />
          {/* 順序等距：刻度尺上畫一段一段的軸線（每格一段、格與格之間斷開），一看就知道不是連續的時間 */}
          {layout.slotYs.map((yv, i) => (
            <line
              key={`seg-${i}`}
              x1={layout.rulerX + RULER_W - 4 * S}
              x2={layout.rulerX + RULER_W - 4 * S}
              y1={Math.max(layout.axisTop, yv - layout.slotPx / 2 + 3 * S)}
              y2={Math.min(layout.axisTop + layout.contentH, yv + layout.slotPx / 2 - 3 * S)}
              stroke={C.axis}
              strokeWidth={2 * S}
            />
          ))}
          {layout.rulerX > 0 && (
            <line
              x1={layout.rulerX + RULER_W}
              x2={layout.rulerX + RULER_W}
              y1={HEADER_H}
              y2={layout.totalH}
              stroke={C.grid}
            />
          )}

        {/* 單欄合流時關係線要點了才畫，所以得先讓讀者知道「有關係可以看」 */}
        {showRelations && mode === 'merged' && layout.relationLines.length > 0 && (
          <text x={RULER_W + COL_PAD} y={layout.axisTop - 6 * S} fontSize={F.date} fill={C.warn}>
            {fitText(
              `⇄ ${layout.relationLines.length} 組事件關係：點事件查看`,
              Math.max(0, width - RULER_W - COL_PAD * 2),
              F.date,
            )}
          </text>
        )}

        {/* 斷軸記號：⫽ 加上「略過多久」，虛線橫貫全寬。
            沒有這個記號，讀者會以為 1870→1888 跟 1950→1953 佔一樣的高度是等比例的 */}
        {warp.gaps.map((g, i) => {
          const yg = layout.yOfU(g.uCenter)
          if (yg < layout.axisTop - 20 || yg > layout.axisTop + layout.contentH + 20) return null
          return (
            <g key={`gap-${i}`}>
              <line
                x1={layout.rulerX + RULER_W / 2 - 5}
                y1={yg - 6}
                x2={layout.rulerX + RULER_W / 2 + 5}
                y2={yg - 1}
                stroke={C.inkFaint}
                strokeWidth={1.5 * S}
              />
              <line
                x1={layout.rulerX + RULER_W / 2 - 5}
                y1={yg + 1}
                x2={layout.rulerX + RULER_W / 2 + 5}
                y2={yg + 6}
                stroke={C.inkFaint}
                strokeWidth={1.5 * S}
              />
              <line
                x1={layout.rulerX > 0 ? 0 : RULER_W + 5}
                y1={yg}
                x2={width}
                y2={yg}
                stroke={C.axis}
                strokeDasharray="2 6"
              />
              <text
                x={layout.rulerX + RULER_W / 2}
                y={yg - 8 * S}
                textAnchor="middle"
                fontSize={F.footer}
                fill={C.inkFaint}
              >
                略過 {formatSkipped(g.skippedMs)}
              </text>
            </g>
          )
        })}

          {/* 事件關係線（畫在事件圖形下方；點選或滑過事件時相關的線會亮起）。
              單欄合流（手機）時所有關係都變成同一欄內的長弧線，全部畫出來會糊成一團——
              所以那個模式改成「點了才顯示該事件的關係」，畫面乾淨，關係也只差一下點擊 */}
          {showRelations && layout.relationLines.length > 0 && (
            <g pointerEvents="none">
              <defs>
                <marker
                  id="hst-rel-arrow-v"
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
                const active =
                  selectedKey === fromKey ||
                  selectedKey === toKey ||
                  hoveredKey === fromKey ||
                  hoveredKey === toKey
                if (mode === 'merged' && !active) return null
                return (
                  <path
                    key={id}
                    d={d}
                    fill="none"
                    stroke={active ? C.highlight : C.inkFaint}
                    strokeWidth={(active ? 2.5 : 1.25) * S}
                    strokeDasharray={relationDash(type, S)}
                    strokeLinecap={type === 'derives_from' ? 'round' : undefined}
                    opacity={active ? 0.95 : 0.35}
                    markerEnd="url(#hst-rel-arrow-v)"
                  />
                )
              })}
            </g>
          )}

          {/* 事件 */}
          {layout.columns.map(({ band, items }, ci) => (
            <g key={band ? `${band.key}-ev` : `merged-ev-${ci}`}>
              {items.map((it) => {
                const { pe } = it
                const fill = pe.ev.color ?? it.band.color
                const isSelected = selectedKey === it.key
                const barH = Math.max(it.yBot - it.yTop, MIN_BAR_H)
                const dotR = pe.isKey ? KEY_DOT_R : DOT_R
                const cx = it.x + dotR
                return (
                  <g
                    key={it.key}
                    className={onEventSelect ? 'cursor-pointer' : undefined}
                    onDoubleClick={(e) => e.stopPropagation()}
                    onMouseEnter={() => setHoveredKey(it.key)}
                    onMouseLeave={() => setHoveredKey((prev) => (prev === it.key ? null : prev))}
                    onClick={(e) => {
                      if (!onEventSelect) return
                      e.stopPropagation()
                      onEventSelect({
                        key: it.key,
                        sourceId: it.band.sourceId,
                        event: pe.ev,
                        docTitle: it.band.docTitle,
                        trackTitle: it.band.trackTitle,
                        color: fill,
                        relativeNote: pe.relativeNote,
                        clientX: e.clientX,
                        clientY: e.clientY,
                      })
                    }}
                  >
                    {/* 看不見的感應區：整列（圖形＋標題）都點得到，手指不用瞄準小圓點。
                        匯出的圖片不需要，省下來檔案比較乾淨 */}
                    {!exportMode && (
                      <>
                        {it.labelY !== null && (
                          <rect
                            x={it.mirrored ? it.rowLeft : it.x - 6}
                            y={it.labelY - 14}
                            width={Math.max(
                              0,
                              it.mirrored
                                ? it.x + it.shapeW + 6 - it.rowLeft
                                : it.rowRight - it.x + 6,
                            )}
                            height={LABEL_H}
                            fill="transparent"
                          />
                        )}
                        {it.isBar ? (
                          <rect
                            data-event-key={it.key}
                            x={it.x - 6}
                            y={it.yTop - 4}
                            width={it.shapeW + 12}
                            height={Math.max(it.yBot - it.yTop, MIN_BAR_H) + 8}
                            fill="transparent"
                          />
                        ) : (
                          <circle
                            data-event-key={it.key}
                            cx={cx}
                            cy={it.yTop}
                            r={dotR + 10}
                            fill="transparent"
                          />
                        )}
                      </>
                    )}
                    {/* 引線：把標題接回它真正的時間位置（圖形在左、文字在右） */}
                    {it.leader && (
                      <path
                        d={it.leader}
                        fill="none"
                        stroke={fill}
                        strokeWidth={1}
                        opacity={0.3}
                      />
                    )}
                    {/* 重點事件（featured）的常駐光暈 */}
                    {pe.isKey &&
                      (it.isBar ? (
                        <rect
                          x={it.x - 4}
                          y={it.yTop - 4}
                          width={it.shapeW + 8}
                          height={barH + 8}
                          rx={(it.shapeW + 8) / 2}
                          fill={fill}
                          opacity={0.15}
                        />
                      ) : (
                        <circle cx={cx} cy={it.yTop} r={dotR + 4} fill={fill} opacity={0.15} />
                      ))}
                    {/* 選取光環 */}
                    {isSelected &&
                      (it.isBar ? (
                        <rect
                          x={it.x - 3}
                          y={it.yTop - 3}
                          width={it.shapeW + 6}
                          height={barH + 6}
                          rx={(it.shapeW + 6) / 2}
                          fill="none"
                          stroke={fill}
                          strokeWidth={2}
                          opacity={0.5}
                        />
                      ) : (
                        <circle
                          cx={cx}
                          cy={it.yTop}
                          r={dotR + 4}
                          fill="none"
                          stroke={fill}
                          strokeWidth={2}
                          opacity={0.5}
                        />
                      ))}
                    {it.isBar ? (
                      <>
                        <rect
                          x={it.x}
                          y={it.yTop}
                          width={it.shapeW}
                          height={barH}
                          rx={it.shapeW / 2}
                          fill={fill}
                          opacity={0.85}
                        />
                        {/* 進行中：下端蓋一層白色淡出，表示「還沒結束」 */}
                        {pe.ongoing && (
                          <rect
                            x={it.x - 1}
                            y={reversed ? it.yTop : Math.max(it.yTop, it.yBot - 32)}
                            width={it.shapeW + 2}
                            height={Math.min(32, barH)}
                            fill="url(#hst-ongoing-fade-v)"
                          />
                        )}
                      </>
                    ) : pe.estimate ? (
                      /* 推估位置：虛線空心圓點，明確標示「這不是真實日期」 */
                      <circle
                        cx={cx}
                        cy={it.yTop}
                        r={dotR}
                        fill={C.halo}
                        stroke={fill}
                        strokeWidth={2}
                        strokeDasharray="3 2.5"
                      />
                    ) : (
                      <circle cx={cx} cy={it.yTop} r={dotR} fill={fill} />
                    )}

                    {/* 單欄合流：每列開頭標出這是哪一條軸線 */}
                    {it.abbr && it.labelY !== null && (
                      <text
                        x={it.abbrX}
                        y={it.labelY}
                        textAnchor={it.mirrored ? 'end' : 'start'}
                        fontSize={F.footer}
                        fill={it.band.color}
                      >
                        {it.abbr}
                      </text>
                    )}
                    {/* 排不下標題的事件只畫圓點——位置仍然精準，點下去看得到內容 */}
                    {it.labelY !== null && (
                      <text
                        x={it.labelX}
                        y={it.labelY}
                        textAnchor={it.mirrored ? 'end' : 'start'}
                        fontSize={FONT}
                        fontWeight={pe.isKey ? 700 : 400}
                        fill={pe.isKey ? C.ink : C.inkEvent}
                      >
                        {it.dateLabel && (
                          <tspan fill={C.inkFaint} fontWeight={400}>
                            {it.dateLabel}{' '}
                          </tspan>
                        )}
                        {it.title}
                      </text>
                    )}
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

          {/* 標註框：畫在事件之上、欄標題列之下 */}
          {calloutLayout && <CalloutLayer placed={calloutLayout.placed} theme={T} />}

          {/* 欄標題列：捲動時固定在畫面上緣，讀到一半也知道自己在看哪一欄 */}
          <g ref={headerRef}>
            {/* 匯出圖片的頂部標題：輸出的圖自帶脈絡，不必靠貼文說明 */}
            {exportMode && (
              <>
                <rect x={0} y={0} width={width} height={TITLE_H} fill={C.bg} />
                {header && <ExportHeader layout={header} x={14 * S} theme={T} />}
                {/* 順序等距：右上角固定標「非等比」，不可關閉 */}
                {warp.ordinalSlots && (
                  <OrdinalBadge right={width - 12 * S} top={11 * S} theme={T} maxW={width / 2} />
                )}
              </>
            )}
            <g transform={`translate(0 ${layout.headerTop})`}>
            <rect x={0} y={0} width={width} height={HEADER_H} fill={C.bg} />
            <line x1={0} x2={width} y1={HEADER_H} y2={HEADER_H} stroke={C.axis} />
            {/* 出圖的對照版型：刻度尺在中間，範圍文字放在刻度尺上方，才不會壓到左欄的欄標題 */}
            <text
              ref={rangeLabelRef}
              x={exportMode && layout.rulerX > 0 ? layout.rulerX + RULER_W / 2 : 6 * S}
              y={21 * S}
              textAnchor={exportMode && layout.rulerX > 0 ? 'middle' : undefined}
              fontSize={F.footer}
              fill={C.inkFaint}
            >
              {formatRangeLabel(layout.tView)}
            </text>
            {/* 軸被拉長之後，畫面上只看得到一小段——順手告訴讀者整條軸有多長 */}
            {!exportMode && layout.contentH > layout.baseH * 1.2 && (
              <text x={width - 10 * S} y={21 * S} textAnchor="end" fontSize={F.footer} fill={C.axis}>
                {`全 ${formatRangeLabel([warp.toT(layout.axisDomain[0]), warp.toT(layout.axisDomain[1])])}`}
              </text>
            )}
            {mode === 'columns'
              ? layout.columns.map(({ rect, band, hidden }) =>
                  band ? (
                    <g key={`${band.key}-head`}>
                      <rect
                        x={rect.x + 2}
                        y={4 * S}
                        width={Math.max(0, rect.w - 4)}
                        height={HEADER_H - 9 * S}
                        rx={4}
                        fill={band.color}
                        opacity={0.1}
                      />
                      <rect x={rect.x + 2} y={4 * S} width={3} height={HEADER_H - 9 * S} fill={band.color} />
                      {/* 有事件擠到畫不下標題時，在欄標題右側註記件數——
                          不能默默藏起來，也不能被標題截斷吃掉 */}
                      {hidden > 0 && (
                        <text
                          x={rect.x + rect.w - 6 * S}
                          y={22 * S}
                          textAnchor="end"
                          fontSize={F.footer}
                          fontWeight={400}
                          fill={C.warn}
                        >
                          ＋{hidden} 件
                        </text>
                      )}
                      <text x={rect.x + 12 * S} y={22 * S} fontSize={F.event} fontWeight={700} fill={band.color}>
                        {fitText(
                          band.label,
                          Math.max(0, rect.w - 18 * S - (hidden > 0 ? 46 * S : 0)),
                          F.event,
                        )}
                      </text>
                    </g>
                  ) : null,
                )
              : /* 單欄合流：把各軸線的顏色與縮寫列成一排小標籤 */
                bands.map((band, i) => {
                  const chipX = RULER_W + 8 * S + i * 68 * S
                  if (chipX > width - 20) return null
                  return (
                    <g key={`${band.key}-chip`}>
                      <circle cx={chipX} cy={18 * S} r={4 * S} fill={band.color} />
                      <text x={chipX + 8 * S} y={22 * S} fontSize={F.date} fill={C.inkSoft}>
                        {fitText(abbrOf.get(band.key) ?? '', 52 * S, F.date)}
                      </text>
                    </g>
                  )
                })}
            {mode === 'merged' && layout.columns[0]?.hidden > 0 && (
              <text x={width - 10 * S} y={22 * S} textAnchor="end" fontSize={F.footer} fill={C.inkFaint}>
                另有 {layout.columns[0].hidden} 件，放大可見
              </text>
            )}
            </g>
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
              legend={relLegend}
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
      <div
        ref={containerRef}
        className="h-full w-full select-none overflow-y-auto"
        onScroll={(e) => {
          headerRef.current?.setAttribute('transform', `translate(0 ${e.currentTarget.scrollTop})`)
          refreshReturnDir()
          refreshRangeLabel()
          reportDomain()
        }}
      >
        {width > 0 && svgEl}
      </div>
      {returnDir && selectedU != null && (
        <button
          type="button"
          onClick={() => scrollToU(selectedU)}
          className={
            'absolute left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border border-amber-300 bg-amber-50/95 px-3 py-1.5 text-xs font-medium text-amber-800 shadow-md hover:bg-amber-100 ' +
            (returnDir === 'up' ? 'top-3' : 'bottom-3')
          }
        >
          {returnDir === 'up' ? '↑ 回到選取的事件' : '↓ 回到選取的事件'}
        </button>
      )}
    </div>
  )
}
