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
import { formatSkipped } from './gaps'
import { estimateTextWidth } from './layout'
import { buildBands, buildTimelineBase } from './timelineData'
import type { PreparedBand, PreparedEvent } from './timelineData'
import { formatRangeLabel, formatTick, getTicks } from './timeScale'
import type { EventSelection, ScaleMode, ScaleRequest, TimelineSource } from './types'
import {
  columnRects,
  fitContentHeight,
  fitText,
  MIN_COL_W,
  pickVerticalMode,
  RULER_W,
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
  /** 圖片底部的出處小字 */
  footer: string
}

interface Props {
  sources: TimelineSource[]
  /** 是否在事件標題前顯示日期（預設顯示） */
  showDates?: boolean
  /** 日期是否含年份（預設顯示） */
  showYears?: boolean
  /** 是否摺疊大段空白（SPEC display.collapseGaps），預設不摺疊 */
  collapseGaps?: boolean
  /** ui 層下的指令：「切到某個尺度」 */
  scaleRequest?: ScaleRequest | null
  /** 縮放後回報目前落在哪個尺度，讓 ui 層的按鈕高亮 */
  onScaleModeChange?: (mode: ScaleMode) => void
  /** 目前被選取的事件（組合鍵），該事件會畫上光環 */
  selectedKey?: string | null
  /** 點事件 → 回報選取；點空白處 → 回報 null */
  onEventSelect?: (selection: EventSelection | null) => void
  /** 回報目前的可視時間範圍（壓縮座標 u），讓 ui 層的比例匯出做到所見即所得 */
  onDomainChange?: (domain: [number, number]) => void
  /** 受控的可視範圍（匯出時由外部指定；畫面上的檢視不傳） */
  domain?: [number, number]
  /** 有值 = 匯出模式（固定尺寸、不互動） */
  exportMode?: VerticalExportOptions
  // 之後會補上 onEventCreate（直式編輯）——現在不留半成品的程式碼，屆時再加。
}

const HEADER_H = 34 // 頂部欄標題列高度（捲動時固定在上緣）
const TOP_PAD = 18
const BOTTOM_PAD = 32
const COL_PAD = 10 // 欄內左右留白
// 副車道每往右錯開多少。要比最大的圓點（重點事件直徑 15）再寬一點，
// 錯開後的圓點才不會擠成一團
const LANE_STEP = 16
const LANE_COUNT = 4 // 副車道最多幾層，再多就會把標題的寬度吃光
const LABEL_H = 18 // 一行標題佔的高度
const FONT = 12
const DOT_R = 5
const KEY_DOT_R = 7.5
const BAR_W = 12
const KEY_BAR_W = 16
const MIN_BAR_H = 10 // 很短的區間事件至少畫這麼長，才看得見
const TITLE_H = 42 // 匯出圖片頂部的標題列
const FOOTER_H = 22 // 匯出圖片底部的出處小字
const ROW_H = 96 // 一個事件「舒服讀」大概需要的高度（決定整條軸最長拉到多長）
// 標題最多可以離自己的時間位置多遠。超過就不畫標題，只留圓點——
// 否則讀者會對不上左邊的年份刻度，以為那件事發生在別的年代
const MAX_DRIFT = 26
const LABEL_GAP = 8 // 圖形右緣到標題的距離

const DAY = 86_400_000
/** 各尺度按鈕對應的可視時間跨度（與橫式共用同一組數字，切換方向時感受一致） */
const SCALE_SPANS: Record<Exclude<ScaleMode, 'year'>, number> = {
  day: 14 * DAY,
  week: 91 * DAY,
  month: 730 * DAY,
}
const MIN_SPAN = DAY / 4 // 最多放大到 6 小時
const MAX_SPAN = 400 * 365 * DAY // 最多縮小到 400 年

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
  collapseGaps = false,
  scaleRequest,
  onScaleModeChange,
  selectedKey,
  onEventSelect,
  onDomainChange,
  domain: domainProp,
  exportMode,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  // 欄標題列：捲動時用 transform 貼回上緣（直接改 DOM，避免每個捲動事件都重繪整張圖）
  const headerRef = useRef<SVGGElement>(null)
  const [measuredWidth, setMeasuredWidth] = useState(960)
  const width = exportMode?.width ?? measuredWidth
  // 「回到選取的事件」浮動鈕的方向（事件捲出畫面時才出現）
  const [returnDir, setReturnDir] = useState<'up' | 'down' | null>(null)

  // 資料準備與橫式共用同一份（timelineData），所以兩種方向不可能畫出不同的事件
  const base = useMemo(() => buildTimelineBase(sources, collapseGaps), [sources, collapseGaps])
  const bands = useMemo(
    () => buildBands(sources, base, { showDates, showYears }),
    [sources, base, showDates, showYears],
  )
  const { warp, initialDomain, anchorTimes } = base

  // domainState 為 null 代表「跟著初始範圍走」（尚未縮放，或按了「年」回到全貌）
  const [domainState, setDomainState] = useState<[number, number] | null>(null)
  const domain = domainProp ?? domainState ?? initialDomain
  const domainRef = useRef(domain)
  domainRef.current = domain

  // 摺疊開關或資料變動時 warp 會換：把已縮放的視野換算到新座標，畫面才不會跳走
  const prevWarpRef = useRef(warp)
  useEffect(() => {
    const prev = prevWarpRef.current
    if (prev === warp) return
    setDomainState((d) => (d ? [warp.toU(prev.toT(d[0])), warp.toU(prev.toT(d[1]))] : d))
    prevWarpRef.current = warp
  }, [warp])

  // 回報目前看到的時間範圍：ui 層的「比例匯出」要照著這個範圍出圖（所見即所得）
  useEffect(() => {
    onDomainChange?.(domain)
  }, [domain, onDomainChange])

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
  const mode = exportMode ? 'columns' : pickVerticalMode(width, bands.length)

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
    const [d0, d1] = domain
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
    // 匯出：高度是使用者選的比例決定的，軸只能塞進剩下的空間
    const contentH = exportMode
      ? Math.max(80, exportMode.height - axisTop - FOOTER_H - BOTTOM_PAD)
      : fitContentHeight(groups, {
          maxH: Math.min(12_000, Math.max(520, rowCount * ROW_H)),
        })

    /** 壓縮座標 u ↔ 畫面 y（縮放、置中、浮動鈕都靠這對換算） */
    const yOfU = (u: number) => axisTop + ((u - d0) / span) * contentH
    const uOfY = (yv: number) => d0 + ((yv - axisTop) / contentH) * span
    /** 真實時間 → 畫面 y。跨出目前範圍的長條夾在軸的兩端，不會畫到天邊去 */
    const y = (t: number) =>
      Math.min(axisTop + contentH, Math.max(axisTop, yOfU(warp.toU(t))))

    /** 把一組事件排進一個矩形欄位裡 */
    const place = (
      entries: Array<{ band: PreparedBand; pe: PreparedEvent }>,
      rect: { x: number; w: number },
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
      const naturalLabelYs = raw.map((r) => (r.isBar ? r.yTop + 12 : r.yTop + 4))
      const labelYs = stackLabels(naturalLabelYs, LABEL_H, MAX_DRIFT)
      const right = rect.x + rect.w - COL_PAD

      // 超出可用層數時「繞回第 0 層」而不是全部壓在最後一層——
      // 壓在同一層會讓密集區的圓點疊成一坨，繞回去至少還是散開的
      const laneOf = (i: number) => lanes[i] % LANE_COUNT
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
            (m, r) => Math.max(m, estimateTextWidth(abbrOf.get(r.band.key) ?? '', 10)),
            0,
          ) + 6
        : 0
      const abbrX = rect.x + COL_PAD + gutter + LABEL_GAP
      const labelX = abbrX + abbrW
      const avail = right - labelX

      return raw.map((r, i) => {
        const x = rect.x + COL_PAD + laneOf(i) * LANE_STEP
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
        const shapeRight = x + shapeW
        const drift = labelY - naturalLabelYs[i]
        const leader =
          drift > 3 || labelX - shapeRight > 18
            ? `M ${shapeRight + 3} ${r.yTop} H ${labelX - 10} V ${labelY - 4} H ${labelX - 3}`
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
          dateLabel,
          title,
          abbr,
          abbrX,
        }
      })
    }

    const rects =
      mode === 'merged'
        ? [{ x: RULER_W, w: Math.max(0, width - RULER_W) }]
        : columnRects(width, visibleBands.length)

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
      (width - RULER_W) / layoutColumns.length < MIN_COL_W

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
    const ticks = denseRanges.flatMap(([x, z]) => {
      const px = ((warp.toU(z) - warp.toU(x)) / span) * contentH
      if (px < 50) return []
      return getTicks([x, z], px).filter((d) => d.getTime() >= x && d.getTime() <= z)
    })

    return {
      totalH,
      headerTop,
      axisTop,
      contentH,
      columns: layoutColumns.map((c) => ({ ...c, hidden: hiddenOf(c.items) })),
      ticks,
      y,
      yOfU,
      uOfY,
      tView,
      hiddenTotal,
      narrowColumns,
    }
  }, [bands, mode, width, warp, domain, abbrOf, exportMode])

  // 版面隨時可能重算（縮放、改欄數），互動要用「最新的一份」換算座標
  const layoutRef = useRef(layout)
  layoutRef.current = layout

  // 縮放或切尺度之後，要把某個時間點捲回指定的畫面位置——版面重算完才知道 y 在哪，
  // 所以先把要求記在這裡，等下面的 useLayoutEffect 執行
  const pendingScroll = useRef<{ u: number; offset: number | 'center' } | null>(null)

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, selectedU])

  // ui 層的尺度按鈕：日/週/月 → 限定顯示這麼長的一段時間；年 → 回到全貌。
  // 有選取事件時以「該事件」為中心（切尺度不再讓它跑出畫面），否則以目前看到的中間為準
  useEffect(() => {
    if (!scaleRequest) return
    const el = containerRef.current
    const center =
      selectedU ??
      (el
        ? layoutRef.current.uOfY(el.scrollTop + el.clientHeight / 2)
        : (domainRef.current[0] + domainRef.current[1]) / 2)
    const fullSpan = initialDomain[1] - initialDomain[0]
    const span = scaleRequest.mode === 'year' ? fullSpan : SCALE_SPANS[scaleRequest.mode]
    if (span >= fullSpan) {
      setDomainState(null)
    } else {
      const a = Math.min(
        initialDomain[1] - span,
        Math.max(initialDomain[0], center - span / 2),
      )
      setDomainState([a, a + span])
    }
    pendingScroll.current = { u: center, offset: 'center' }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scaleRequest?.nonce])

  // 回報目前尺度，讓 ui 的按鈕高亮跟著縮放走（門檻與橫式相同）
  useEffect(() => {
    const span = domain[1] - domain[0]
    const mode: ScaleMode =
      span <= 30 * DAY ? 'day' : span <= 200 * DAY ? 'week' : span <= 1500 * DAY ? 'month' : 'year'
    onScaleModeChange?.(mode)
  }, [domain, onScaleModeChange])

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
      const [a, b] = domainRef.current
      const span = b - a
      const k = Math.exp(e.deltaY * 0.0015)
      const fullSpan = initialDomain[1] - initialDomain[0]
      const newSpan = Math.min(MAX_SPAN, fullSpan, Math.max(MIN_SPAN, span * k))
      // 已經看到整條軸了就別再縮小——再縮下去只是把所有事件擠成一團
      if (newSpan >= fullSpan) {
        setDomainState(null)
        pendingScroll.current = { u: anchor, offset }
        return
      }
      const f = (anchor - a) / span
      // 夾在整條軸的範圍內，不會平移到資料以外的空白
      const a2 = Math.min(
        initialDomain[1] - newSpan,
        Math.max(initialDomain[0], anchor - f * newSpan),
      )
      setDomainState([a2, a2 + newSpan])
      // 縮放後讓游標底下的那個時間點留在原地，畫面才不會亂跳
      pendingScroll.current = { u: anchor, offset }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources.length > 0, initialDomain]) // 空狀態沒有 svg，出現後要重掛監聽

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
      ? domainRef.current
      : visibleURange(
          el?.scrollTop ?? 0,
          el?.clientHeight ?? 0,
          L.axisTop,
          L.contentH,
          domainRef.current,
        )
    node.textContent = formatRangeLabel([warp.toT(u0), warp.toT(u1)])
  }

  const svgEl = (
    <svg
      ref={svgRef}
      id={exportMode?.svgId ?? 'hackstory-timeline-svg'}
      width={width}
      height={layout.totalH}
      className="block bg-white"
      data-hidden={layout.hiddenTotal}
      data-narrow-columns={layout.narrowColumns ? '1' : '0'}
      onClick={exportMode ? undefined : () => onEventSelect?.(null)}
    >
          {/* 進行中事件下端的淡出漸層（方向由橫式的左右轉成上下） */}
          <defs>
            <linearGradient id="hst-ongoing-fade-v" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
              <stop offset="1" stopColor="#ffffff" stopOpacity="1" />
            </linearGradient>
          </defs>

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

          {/* 橫線格線與左側刻度文字 */}
          {layout.ticks.map((d, i) => {
            const yv = layout.y(d.getTime())
            return (
              <g key={`tick-${i}`}>
                <line x1={RULER_W} x2={width} y1={yv} y2={yv} stroke="#e2e8f0" strokeWidth={1} />
                <text x={8} y={yv + 4} fontSize={11} fill="#64748b">
                  {formatTick(d)}
                </text>
              </g>
            )
          })}
          <line x1={RULER_W} x2={RULER_W} y1={HEADER_H} y2={layout.totalH} stroke="#e2e8f0" />

        {/* 斷軸記號：⫽ 加上「略過多久」，虛線橫貫全寬。
            沒有這個記號，讀者會以為 1870→1888 跟 1950→1953 佔一樣的高度是等比例的 */}
        {warp.gaps.map((g, i) => {
          const yg = layout.yOfU(g.uCenter)
          if (yg < layout.axisTop - 20 || yg > layout.axisTop + layout.contentH + 20) return null
          return (
            <g key={`gap-${i}`}>
              <line
                x1={RULER_W - 5}
                y1={yg - 6}
                x2={RULER_W + 5}
                y2={yg - 1}
                stroke="#94a3b8"
                strokeWidth={1.5}
              />
              <line
                x1={RULER_W - 5}
                y1={yg + 1}
                x2={RULER_W + 5}
                y2={yg + 6}
                stroke="#94a3b8"
                strokeWidth={1.5}
              />
              <line
                x1={RULER_W + 5}
                y1={yg}
                x2={width}
                y2={yg}
                stroke="#cbd5e1"
                strokeDasharray="2 6"
              />
              <text x={6} y={yg - 8} fontSize={10} fill="#94a3b8">
                略過 {formatSkipped(g.skippedMs)}
              </text>
            </g>
          )
        })}

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
                            x={it.x - 6}
                            y={it.labelY - 14}
                            width={Math.max(0, width - it.x - 2)}
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
                            y={Math.max(it.yTop, it.yBot - 32)}
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
                        fill="#ffffff"
                        stroke={fill}
                        strokeWidth={2}
                        strokeDasharray="3 2.5"
                      />
                    ) : (
                      <circle cx={cx} cy={it.yTop} r={dotR} fill={fill} />
                    )}

                    {/* 單欄合流：每列開頭標出這是哪一條軸線 */}
                    {it.abbr && it.labelY !== null && (
                      <text x={it.abbrX} y={it.labelY} fontSize={10} fill={it.band.color}>
                        {it.abbr}
                      </text>
                    )}
                    {/* 排不下標題的事件只畫圓點——位置仍然精準，點下去看得到內容 */}
                    {it.labelY !== null && (
                      <text
                        x={it.labelX}
                        y={it.labelY}
                        fontSize={FONT}
                        fontWeight={pe.isKey ? 700 : 400}
                        fill={pe.isKey ? '#1e293b' : '#334155'}
                      >
                        {it.dateLabel && (
                          <tspan fill="#94a3b8" fontWeight={400}>
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

          {/* 欄標題列：捲動時固定在畫面上緣，讀到一半也知道自己在看哪一欄 */}
          <g ref={headerRef}>
            {/* 匯出圖片的頂部標題：輸出的圖自帶脈絡，不必靠貼文說明 */}
            {exportMode && (
              <>
                <rect x={0} y={0} width={width} height={TITLE_H} fill="#ffffff" />
                <text x={14} y={27} fontSize={16} fontWeight={700} fill="#1e293b">
                  {fitText(exportMode.title, width - 28, 16)}
                </text>
              </>
            )}
            <g transform={`translate(0 ${layout.headerTop})`}>
            <rect x={0} y={0} width={width} height={HEADER_H} fill="#ffffff" />
            <line x1={0} x2={width} y1={HEADER_H} y2={HEADER_H} stroke="#cbd5e1" />
            <text ref={rangeLabelRef} x={6} y={21} fontSize={10} fill="#94a3b8">
              {formatRangeLabel(layout.tView)}
            </text>
            {mode === 'columns'
              ? layout.columns.map(({ rect, band, hidden }) =>
                  band ? (
                    <g key={`${band.key}-head`}>
                      <rect
                        x={rect.x + 2}
                        y={4}
                        width={Math.max(0, rect.w - 4)}
                        height={HEADER_H - 9}
                        rx={4}
                        fill={band.color}
                        opacity={0.1}
                      />
                      <rect x={rect.x + 2} y={4} width={3} height={HEADER_H - 9} fill={band.color} />
                      {/* 有事件擠到畫不下標題時，在欄標題右側註記件數——
                          不能默默藏起來，也不能被標題截斷吃掉 */}
                      {hidden > 0 && (
                        <text
                          x={rect.x + rect.w - 6}
                          y={22}
                          textAnchor="end"
                          fontSize={10}
                          fontWeight={400}
                          fill="#b45309"
                        >
                          ＋{hidden} 件
                        </text>
                      )}
                      <text x={rect.x + 12} y={22} fontSize={12} fontWeight={700} fill={band.color}>
                        {fitText(
                          band.label,
                          Math.max(0, rect.w - 18 - (hidden > 0 ? 46 : 0)),
                          12,
                        )}
                      </text>
                    </g>
                  ) : null,
                )
              : /* 單欄合流：把各軸線的顏色與縮寫列成一排小標籤 */
                bands.map((band, i) => {
                  const chipX = RULER_W + 8 + i * 68
                  if (chipX > width - 20) return null
                  return (
                    <g key={`${band.key}-chip`}>
                      <circle cx={chipX} cy={18} r={4} fill={band.color} />
                      <text x={chipX + 8} y={22} fontSize={11} fill="#475569">
                        {fitText(abbrOf.get(band.key) ?? '', 52, 11)}
                      </text>
                    </g>
                  )
                })}
            {mode === 'merged' && layout.columns[0]?.hidden > 0 && (
              <text x={width - 10} y={22} textAnchor="end" fontSize={10} fill="#94a3b8">
                另有 {layout.columns[0].hidden} 件，放大可見
              </text>
            )}
            </g>
          </g>
          {/* 匯出圖片底部的出處小字 */}
          {exportMode && (
            <text
              x={width - 12}
              y={exportMode.height - 8}
              textAnchor="end"
              fontSize={10}
              fill="#94a3b8"
            >
              {exportMode.footer}
            </text>
          )}
    </svg>
  )

  // 匯出模式：固定尺寸、不捲動、不互動
  if (exportMode) {
    return (
      <div style={{ width, height: exportMode.height, overflow: 'hidden', background: '#fff' }}>
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
        }}
      >
        {svgEl}
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
