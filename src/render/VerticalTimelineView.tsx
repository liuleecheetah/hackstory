// render 層：直式時間軸檢視
//
// 時間由上往下流（上＝早，下＝晚），多條軸線變成左右並排的欄。
// 文字仍然是橫的——這是直式的重點：每個事件天然擁有一整行寬度，適合閱讀。
//
// 這一版是「閱讀與輸出」模式：整條軸一次攤開，用捲動讀完。
// 縮放、拖曳、尺度切換、點事件看詳情屬於下一步（V2），這裡刻意先不做。
//
// 排版的數學都在 verticalLayout.ts，資料準備都在 timelineData.ts——
// 這個檔案只負責「畫出來」。

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { estimateTextWidth } from './layout'
import { buildBands, buildTimelineBase } from './timelineData'
import type { PreparedBand, PreparedEvent } from './timelineData'
import { formatRangeLabel, formatTick, getTicks } from './timeScale'
import type { TimelineSource } from './types'
import {
  columnRects,
  fitContentHeight,
  fitText,
  pickVerticalMode,
  RULER_W,
  stackLabels,
  verticalLanes,
} from './verticalLayout'

interface Props {
  sources: TimelineSource[]
  /** 是否在事件標題前顯示日期（預設顯示） */
  showDates?: boolean
  /** 日期是否含年份（預設顯示） */
  showYears?: boolean
  /** 是否摺疊大段空白（SPEC display.collapseGaps），預設不摺疊 */
  collapseGaps?: boolean
  /** 目前被選取的事件（組合鍵），該事件會畫上光環 */
  selectedKey?: string | null
  // V2 會補上：scaleRequest / onScaleModeChange / onEventSelect（縮放、捲動、點事件）
  // 之後還會補上 onEventCreate（直式編輯）——現在不留半成品的程式碼，屆時再加。
}

const HEADER_H = 34 // 頂部欄標題列高度（捲動時固定在上緣）
const TOP_PAD = 18
const BOTTOM_PAD = 32
const COL_PAD = 10 // 欄內左右留白
const LANE_STEP = 11 // 副車道每往右錯開多少（只為了讓同時發生的圖形不疊在一起）
const MAX_LANES = 4 // 副車道最多錯開幾層，再多就會吃掉標題的寬度
const LABEL_H = 18 // 一行標題佔的高度
const FONT = 12
const DOT_R = 5
const KEY_DOT_R = 7.5
const BAR_W = 12
const KEY_BAR_W = 16
const MIN_BAR_H = 10 // 很短的區間事件至少畫這麼長，才看得見
const ROW_H = 64 // 一個事件「舒服讀」大概需要的高度（決定整條軸最長拉到多長）
const LABEL_GAP = 8 // 圖形右緣到標題的距離

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
  /** 標題實際被畫在哪一行（可能被往下擠，這時會補一條連接線） */
  labelY: number
  /** 標題被往下擠了多少（0 = 就在事件旁邊） */
  drift: number
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
  selectedKey,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  // 欄標題列：捲動時用 transform 貼回上緣（直接改 DOM，避免每個捲動事件都重繪整張圖）
  const headerRef = useRef<SVGGElement>(null)
  const [width, setWidth] = useState(960)

  // 資料準備與橫式共用同一份（timelineData），所以兩種方向不可能畫出不同的事件
  const base = useMemo(() => buildTimelineBase(sources, collapseGaps), [sources, collapseGaps])
  const bands = useMemo(
    () => buildBands(sources, base, { showDates, showYears }),
    [sources, base, showDates, showYears],
  )
  const { warp, initialDomain } = base

  // 量測容器寬度：欄夠不夠寬決定要多欄並排還是單欄合流
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

  const mode = pickVerticalMode(width, bands.length)

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
    const [u0, u1] = initialDomain
    const span = u1 - u0 || 1

    // 內容高度：事件擠在同一段時間時就把軸拉長，
    // 讓標題不必被擠得離自己的時間位置太遠（一次攤開，用捲動讀完）
    const norm = (t: number) => (warp.toU(t) - u0) / span
    const groups =
      mode === 'merged'
        ? [bands.flatMap((b) => b.events.map((e) => norm(e.tStart))).sort((a, b) => a - b)]
        : bands.map((b) => b.events.map((e) => norm(e.tStart)))
    // 軸再怎麼拉長，也不超過「每個事件一行」的長度——否則事件全擠在
    // 某十年的時間軸，會被拉成幾千像素的空白，讀者只是在捲空氣
    const rowCount = groups.reduce((n, g) => Math.max(n, g.length), 0)
    const contentH = fitContentHeight(groups, {
      maxH: Math.min(12_000, Math.max(520, rowCount * ROW_H)),
    })
    /** 真實時間 → 畫面 y（先換算到壓縮座標，空白摺疊才會生效） */
    const y = (t: number) => HEADER_H + TOP_PAD + ((warp.toU(t) - u0) / span) * contentH

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
      const labelYs = stackLabels(naturalLabelYs, LABEL_H)
      const right = rect.x + rect.w - COL_PAD

      return raw.map((r, i) => {
        const x = rect.x + COL_PAD + Math.min(lanes[i], MAX_LANES) * LANE_STEP
        const shapeW = r.isBar
          ? r.pe.isKey
            ? KEY_BAR_W
            : BAR_W
          : (r.pe.isKey ? KEY_DOT_R : DOT_R) * 2
        const abbr = withAbbr ? (abbrOf.get(r.band.key) ?? null) : null
        const abbrX = x + shapeW + LABEL_GAP
        const abbrW = abbr ? estimateTextWidth(abbr, 10) + 6 : 0
        const labelX = abbrX + abbrW
        const avail = right - labelX

        // 標題依剩餘寬度截斷；連日期都擠不下時，寧可捨棄日期也要留住標題
        let dateLabel = r.pe.dateLabel
        const prefixW = dateLabel ? estimateTextWidth(`${dateLabel} `, FONT) : 0
        let title = fitText(r.pe.ev.title, avail - prefixW, FONT)
        if (title === '' && dateLabel) {
          dateLabel = ''
          title = fitText(r.pe.ev.title, avail, FONT)
        }

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
          labelY: labelYs[i],
          drift: labelYs[i] - naturalLabelYs[i],
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
        : columnRects(width, bands.length)

    const layoutColumns =
      mode === 'merged'
        ? [
            {
              rect: rects[0],
              band: null as PreparedBand | null,
              items: place(
                bands.flatMap((band) => band.events.map((pe) => ({ band, pe }))),
                rects[0],
                true,
              ),
            },
          ]
        : bands.map((band, i) => ({
            rect: rects[i],
            band,
            items: place(
              band.events.map((pe) => ({ band, pe })),
              rects[i],
              false,
            ),
          }))

    // 事件擠在最下面時，標題會被堆到軸的盡頭之外——SVG 要留得下它們
    const lowest = layoutColumns.reduce(
      (m, c) => c.items.reduce((n, it) => Math.max(n, it.labelY, it.yBot), m),
      0,
    )
    const totalH = Math.max(HEADER_H + TOP_PAD + contentH + BOTTOM_PAD, lowest + BOTTOM_PAD)

    // 刻度：扣掉被摺疊的空白，每段密集區依自己佔的高度各自產生刻度
    const tView: [number, number] = [warp.toT(u0), warp.toT(u1)]
    const denseRanges: Array<[number, number]> = []
    let cursor = tView[0]
    for (const g of warp.gaps) {
      if (g.tEnd <= tView[0] || g.tStart >= tView[1]) continue
      if (g.tStart > cursor) denseRanges.push([cursor, g.tStart])
      cursor = Math.max(cursor, g.tEnd)
    }
    if (cursor < tView[1]) denseRanges.push([cursor, tView[1]])
    const ticks = denseRanges.flatMap(([a, b]) => {
      const px = ((warp.toU(b) - warp.toU(a)) / span) * contentH
      if (px < 50) return []
      return getTicks([a, b], px).filter((d) => d.getTime() >= a && d.getTime() <= b)
    })

    return { totalH, columns: layoutColumns, ticks, y, tView }
  }, [bands, mode, width, warp, initialDomain, abbrOf])

  // 版面重算後把欄標題列貼回目前的捲動位置（避免切換方向時標題飄在半空中）
  useLayoutEffect(() => {
    const top = containerRef.current?.scrollTop ?? 0
    headerRef.current?.setAttribute('transform', `translate(0 ${top})`)
  }, [layout])

  if (sources.length === 0) {
    return (
      <div ref={containerRef} className="flex h-full items-center justify-center text-slate-400">
        沒有可顯示的圖層——請在左側面板勾選或載入 .hst.json 檔案
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="h-full w-full select-none overflow-y-auto"
      onScroll={(e) =>
        headerRef.current?.setAttribute('transform', `translate(0 ${e.currentTarget.scrollTop})`)
      }
    >
      <svg
        id="hackstory-timeline-svg"
        width={width}
        height={layout.totalH}
        className="block bg-white"
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
                <g key={it.key}>
                  {/* 標題被擠開時，用一條細線把它接回真正的時間位置 */}
                  {it.drift > 3 && (
                    <line
                      x1={cx}
                      x2={cx}
                      y1={it.isBar ? it.yBot : it.yTop + dotR}
                      y2={it.labelY - 4}
                      stroke={fill}
                      strokeWidth={1}
                      opacity={0.35}
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
                  {it.abbr && (
                    <text x={it.abbrX} y={it.labelY} fontSize={10} fill={it.band.color}>
                      {it.abbr}
                    </text>
                  )}
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
                </g>
              )
            })}
          </g>
        ))}

        {/* 欄標題列：捲動時固定在畫面上緣，讀到一半也知道自己在看哪一欄 */}
        <g ref={headerRef}>
          <rect x={0} y={0} width={width} height={HEADER_H} fill="#ffffff" />
          <line x1={0} x2={width} y1={HEADER_H} y2={HEADER_H} stroke="#cbd5e1" />
          <text x={6} y={21} fontSize={10} fill="#94a3b8">
            {formatRangeLabel(layout.tView)}
          </text>
          {mode === 'columns'
            ? layout.columns.map(({ rect, band }) =>
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
                    <text x={rect.x + 12} y={22} fontSize={12} fontWeight={700} fill={band.color}>
                      {fitText(band.label, Math.max(0, rect.w - 18), 12)}
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
        </g>
      </svg>
    </div>
  )
}
