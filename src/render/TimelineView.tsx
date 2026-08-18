// render 層：時間軸視覺化引擎
// 自己用 SVG 畫（專案禁令：不引入 vis.js 等任何現成時間軸函式庫）。
// 這一層只認得 core 的資料模型，不知道資料是從 CSV、JSON 還是別的地方來的，
// 也不知道「圖層」怎麼管理——它只負責把收到的多份文件畫出來。

import { useEffect, useMemo, useRef, useState } from 'react'
import { sameDocumentRelations } from '../core'
import { formatSkipped } from './gaps'
import { assignLanes, estimateTextWidth } from './layout'
import { buildBands, buildTimelineBase, RELATION_LABELS } from './timelineData'
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
  /** 是否繪製事件關係線（SPEC 第 7 節 relations，預設顯示） */
  showRelations?: boolean
  /** 是否摺疊大段空白（SPEC display.collapseGaps），預設不摺疊 */
  collapseGaps?: boolean
  /** 精簡模式：把事件列高、圓點、文字縮小，同樣高度塞更多事件、其他軸線比較看得到 */
  compact?: boolean
  /** 目前被選取的事件（組合鍵），該事件會畫上光環 */
  selectedKey?: string | null
  /** 點事件 → 回報選取；點空白處 → 回報 null */
  onEventSelect?: (selection: EventSelection | null) => void
  /** 在軸線空白處點兩下 → 回報新增事件的草稿資訊（未提供時停用，例如嵌入模式） */
  onEventCreate?: (draft: NewEventDraft) => void
  /** 回報目前的可視時間範圍（壓縮座標 u），讓 ui 層的比例匯出做到所見即所得 */
  onDomainChange?: (domain: [number, number]) => void
}

const DAY = 86_400_000
const AXIS_H = 46 // 頂部刻度列高度（上排放「可視範圍」文字，下排放刻度數字，避免兩者疊在一起）
const TRACK_LABEL_H = 26 // 軸線標題列高度
const LANE_H = 26 // 每條車道高度
const BAND_GAP = 12 // 軸線之間的間距
const DOT_R = 5

/** 各尺度按鈕對應的可視時間跨度 */
const SCALE_SPANS: Record<Exclude<ScaleMode, 'year'>, number> = {
  day: 14 * DAY,
  week: 91 * DAY,
  month: 730 * DAY,
}
const MIN_SPAN = DAY / 4 // 最多放大到 6 小時
const MAX_SPAN = 400 * 365 * DAY // 最多縮小到 400 年

export function TimelineView({
  sources,
  scaleRequest,
  onScaleModeChange,
  showDates = true,
  showYears = true,
  showRelations = true,
  collapseGaps = false,
  compact = false,
  selectedKey,
  onEventSelect,
  onEventCreate,
  onDomainChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [width, setWidth] = useState(960)

  // 尺寸度量：精簡模式用縮小的一組，一般模式沿用上方的模組常數。
  // 事件的圓點、長條、文字、車道高度、軸線間距都跟著這組數字走。
  const M = useMemo(
    () =>
      compact
        ? { laneH: 17, trackLabelH: 20, bandGap: 7, dotR: 4, keyDotR: 6, barH: 9, keyBarH: 12, font: 11 }
        : {
            laneH: LANE_H,
            trackLabelH: TRACK_LABEL_H,
            bandGap: BAND_GAP,
            dotR: DOT_R,
            keyDotR: DOT_R + 2.5,
            barH: 12,
            keyBarH: 16,
            font: 12,
          },
    [compact],
  )

  // 與方向無關的資料準備都交給資料層（timelineData）：相對時間求解、空白摺疊
  // 對應、初始可視範圍、事件定位時間。分兩步呼叫是為了快取——切換「顯示日期」
  // 之類的文字選項時不必重算 warp，畫面才不會跳。
  const base = useMemo(() => buildTimelineBase(sources, collapseGaps), [sources, collapseGaps])
  const { warp, initialDomain, anchorTimes } = base

  // 每條軸線要畫哪些事件、它們的時間範圍與標題文字（同樣與方向無關）
  const preparedBands = useMemo(
    () => buildBands(sources, base, { showDates, showYears }),
    [sources, base, showDates, showYears],
  )

  // domainState 為 null 代表「跟著初始範圍走」（尚未縮放，或按了「年」回到全貌）。
  // 這樣切換圖層顯示隱藏時，使用者已縮放的視野不會被重設。
  const [domainState, setDomainState] = useState<[number, number] | null>(null)
  const domain = domainState ?? initialDomain
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
      if (w > 0) setWidth(w)
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
  }, [sources.length > 0]) // 空狀態沒有 svg，出現後要重掛監聽

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
    const x = (t: number) => ((warp.toU(t) - a) / (b - a)) * width

    let y = AXIS_H + 8

    const bands = preparedBands.map((band) => {
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

          const labelW = estimateTextWidth(
            pe.dateLabel ? `${pe.dateLabel} ${pe.title}` : pe.title,
            M.font,
          )
          // 標題預設放在圖形右側；右邊放不下時翻到左側，避免被畫面邊緣切掉
          const labelSide: 'right' | 'left' =
            shapeR + 6 + labelW > width && shapeL - 6 - labelW > 0 ? 'left' : 'right'
          const occL = labelSide === 'left' ? shapeL - 6 - labelW : shapeL
          const occR = labelSide === 'right' ? shapeR + 6 + labelW : shapeR
          return { ...pe, label: pe.title, shapeL, shapeR, labelSide, occL, occR }
        })
        .sort((p, q) => p.occL - q.occL)

      const lanes = assignLanes(items.map((it) => ({ left: it.occL, right: it.occR })))
      const laneCount = items.length > 0 ? Math.max(...lanes) + 1 : 1
      const bandTop = y
      const bandH = M.trackLabelH + laneCount * M.laneH + 6
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
        color: band.color,
        bandTop,
        bandH,
        firstU: items.length > 0 ? firstU : null,
        lastU: items.length > 0 ? lastU : null,
        items: items.map((it, j) => ({
          ...it,
          lane: lanes[j],
          cy: bandTop + M.trackLabelH + lanes[j] * M.laneH + M.laneH / 2,
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
        const labelW = estimateTextWidth(label, 11) + 18
        const labelX = Math.min(
          Math.max((from.x + to.x) / 2, labelW / 2 + 4),
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

    return { bands, relationLines, height: Math.max(y + 8, 320), x }
  }, [sources, preparedBands, domain, width, warp, M])

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
    const px = ((warp.toU(b) - warp.toU(a)) / (domain[1] - domain[0])) * width
    if (px < 50) return []
    return getTicks([a, b], px).filter((d) => d.getTime() >= a && d.getTime() <= b)
  })
  // 壓縮座標 → 像素（畫斷軸記號用）
  const xOfU = (u: number) => ((u - domain[0]) / (domain[1] - domain[0])) * width

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

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full select-none overflow-y-auto">
      <svg
        ref={svgRef}
        id="hackstory-timeline-svg"
        width={width}
        height={layout.height}
        className="block cursor-grab bg-white active:cursor-grabbing"
        style={{ touchAction: 'none' }}
        onPointerDown={(e) => {
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
        onPointerMove={(e) => {
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
        onPointerLeave={() => setHoveredBand(null)}
        onPointerUp={() => (dragState.current = null)}
        onPointerCancel={() => (dragState.current = null)}
        onClick={() => {
          // 點空白處（不是拖曳）→ 取消選取
          if (!draggedRef.current) onEventSelect?.(null)
        }}
        onDoubleClick={(e) => {
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
        {/* 進行中事件右端的淡出漸層 */}
        <defs>
          <linearGradient id="hst-ongoing-fade" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="1" />
          </linearGradient>
        </defs>
        {/* 直式格線 */}
        {ticks.map((d, i) => (
          <line
            key={i}
            x1={layout.x(d.getTime())}
            x2={layout.x(d.getTime())}
            y1={AXIS_H}
            y2={layout.height}
            stroke="#e2e8f0"
            strokeWidth={1}
          />
        ))}

        {/* 頂部刻度列 */}
        <line x1={0} x2={width} y1={AXIS_H} y2={AXIS_H} stroke="#cbd5e1" />
        {ticks.map((d, i) => (
          <text
            key={i}
            x={layout.x(d.getTime())}
            y={AXIS_H - 10}
            textAnchor="middle"
            fontSize={12}
            fill="#64748b"
          >
            {formatTick(d)}
          </text>
        ))}
        {/* 左上角：目前可視範圍 */}
        <text x={8} y={14} fontSize={11} fill="#94a3b8">
          {formatRangeLabel(tView)}
        </text>

        {/* 斷軸記號：⫽ 加上「略過多久」，虛線貫穿到底 */}
        {warp.gaps.map((g, i) => {
          const xg = xOfU(g.uCenter)
          if (xg < -30 || xg > width + 30) return null
          return (
            <g key={`gap-${i}`}>
              <line x1={xg - 6} y1={AXIS_H - 5} x2={xg - 1} y2={AXIS_H + 5} stroke="#94a3b8" strokeWidth={1.5} />
              <line x1={xg + 1} y1={AXIS_H - 5} x2={xg + 6} y2={AXIS_H + 5} stroke="#94a3b8" strokeWidth={1.5} />
              <line
                x1={xg}
                y1={AXIS_H + 5}
                x2={xg}
                y2={layout.height}
                stroke="#cbd5e1"
                strokeDasharray="2 6"
              />
              {/* 「略過多久」放在頂部上排（與可視範圍文字同排），
                  避開下排的刻度數字，兩者不再擦到 */}
              <text x={xg} y={14} textAnchor="middle" fontSize={10} fill="#94a3b8">
                {formatSkipped(g.skippedMs)}
              </text>
            </g>
          )
        })}

        {/* 軸線底色與標題 */}
        {layout.bands.map(({ key, label, color, bandTop, bandH }) => (
          <g key={`${key}-bg`}>
            <rect x={0} y={bandTop} width={width} height={bandH} fill={color} opacity={0.05} />
            <rect x={0} y={bandTop} width={3} height={bandH} fill={color} />
            <text x={12} y={bandTop + 18} fontSize={13} fontWeight={700} fill={color}>
              {label}
            </text>
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
                  stroke={active ? '#d97706' : '#94a3b8'}
                  strokeWidth={active ? 2.5 : 1.25}
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
                  {/* 看不見的感應區：滑鼠不用精準壓在小圓點上也能 hover／點擊 */}
                  {kind === 'bar' ? (
                    <rect
                      x={shapeL - 6}
                      y={cy - barH / 2 - 7}
                      width={shapeR - shapeL + 12}
                      height={barH + 14}
                      fill="transparent"
                    />
                  ) : (
                    <circle cx={(shapeL + shapeR) / 2} cy={cy} r={dotR + 8} fill="transparent" />
                  )}
                  {/* 關鍵事件的常駐光暈 */}
                  {isKey &&
                    (kind === 'bar' ? (
                      <rect
                        x={shapeL - 4}
                        y={cy - barH / 2 - 4}
                        width={shapeR - shapeL + 8}
                        height={barH + 8}
                        rx={(barH + 8) / 2}
                        fill={fill}
                        opacity={0.15}
                      />
                    ) : (
                      <circle
                        cx={(shapeL + shapeR) / 2}
                        cy={cy}
                        r={dotR + 4}
                        fill={fill}
                        opacity={0.15}
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
                        rx={(barH + 6) / 2}
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
                        rx={barH / 2}
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
                      fill="#ffffff"
                      stroke={fill}
                      strokeWidth={2}
                      strokeDasharray="3 2.5"
                    />
                  ) : (
                    <circle cx={(shapeL + shapeR) / 2} cy={cy} r={dotR} fill={fill} />
                  )}
                  <text
                    x={labelSide === 'right' ? shapeR + 6 : shapeL - 6}
                    y={cy + 4}
                    textAnchor={labelSide === 'right' ? 'start' : 'end'}
                    fontSize={M.font}
                    fontWeight={isKey ? 700 : 400}
                    fill={isKey ? '#1e293b' : '#334155'}
                  >
                    {dateLabel && <tspan fill="#94a3b8" fontWeight={400}>{dateLabel} </tspan>}
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
                    y={labelY - 10}
                    width={labelW}
                    height={20}
                    rx={10}
                    fill="#fffbeb"
                    stroke="#f59e0b"
                    strokeWidth={1}
                  />
                  <text
                    x={labelX}
                    y={labelY + 4}
                    textAnchor="middle"
                    fontSize={11}
                    fontWeight={600}
                    fill="#b45309"
                  >
                    {label}
                  </text>
                </g>
              ))}
          </g>
        )}

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
                <rect x={bx} y={by} width={26} height={20} rx={5} fill="#ffffff" stroke="#cbd5e1" />
                <text x={bx + 13} y={by + 14} textAnchor="middle" fontSize={13} fill="#475569">
                  {glyph}
                </text>
              </g>
            )
            return (
              <g key={`${bd.key}-nav`}>
                {btn(width - 62, '⇤', bd.firstU!, '跳到這條軸線最早的事件')}
                {btn(width - 32, '⇥', bd.lastU!, '跳到這條軸線最新的事件')}
              </g>
            )
          })}
      </svg>
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
