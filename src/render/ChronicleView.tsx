// render 層：版型 D「直式大事記」卡片檢視（只給出圖用）
//
// 每個事件一張卡片：左欄日期、右側卡片寫標題、摘要、查證程度與來源清單（兩者都可關）。
// 卡片依時間先後排列，**間距不代表時間長短**——圖上固定標示這一點（誠實原則）。
// 需要照時間比例看的人，用原本的直式（VerticalTimelineView）。
//
// 排版計算在 chronicleLayout.ts（純函式、有測試），這裡只負責畫。

import { useMemo } from 'react'
import { isAbsolute } from '../core'
import type { ChronicleEntry } from './chronicleLayout'
import { confidenceLabel, layoutChronicle, sourcesText } from './chronicleLayout'
import { estimateTextWidth } from './layout'
import type { RenderTheme } from './theme'
import { THEMES } from './theme'
import { buildBands, buildTimelineBase } from './timelineData'
import type { DateParts } from './timeScale'
import { formatPointParts, formatRangeLabel } from './timeScale'
import type { TimelineSource } from './types'
import type { VerticalExportOptions } from './VerticalTimelineView'
import { fitText } from './verticalLayout'

interface Props {
  sources: TimelineSource[]
  /** 要畫的時間範圍（壓縮座標 u）；不給就畫全部 */
  domain?: [number, number]
  collapseGaps: boolean
  /** 最新的在上面 */
  reversed: boolean
  /** 日期欄要寫年、月、日的哪幾個部分（沒給就全寫） */
  dateParts?: DateParts
  /** 卡片上是否寫查證程度（已查證／據報導／有爭議） */
  showConfidence?: boolean
  /** 卡片上是否列出來源清單 */
  showSources?: boolean
  theme?: RenderTheme
  exportMode: VerticalExportOptions
}

const ALL_PARTS: DateParts = { year: true, month: true, day: true }

export function ChronicleView({
  sources,
  domain,
  collapseGaps,
  reversed,
  dateParts = ALL_PARTS,
  showConfidence = true,
  showSources = true,
  theme = THEMES.screen,
  exportMode,
}: Props) {
  const { width, height } = exportMode
  const C = theme.colors
  const F = theme.font
  const S = theme.scale

  const TITLE_H = (exportMode.subtitle ? 64 : 42) * S
  const NOTE_H = 26 * S // 標題下方那一行：範圍與「依先後排列」說明
  // 有底部註記時（例如「僅列關鍵事件」）多留一行，註記放在出處行上面，窄圖也不會擠在一起
  const FOOTER_H = (26 + (exportMode.note ? 16 : 0)) * S
  const padX = 20 * S
  const dateColW = 104 * S
  const spineX = padX + dateColW - 14 * S

  const { entries, tView } = useMemo(() => {
    const base = buildTimelineBase(sources, collapseGaps)
    const bands = buildBands(sources, base, { showDates: true, showYears: true }, theme.palette)
    const [d0, d1] = domain ?? base.initialDomain
    // 多軸時每張卡片要標出屬於哪一條：同一份文件有好幾條就寫軸線名，否則寫文件名
    const perDoc = new Map<string, number>()
    for (const b of bands) perDoc.set(b.docTitle, (perDoc.get(b.docTitle) ?? 0) + 1)

    const list: Array<ChronicleEntry & { t: number }> = []
    for (const band of bands) {
      for (const pe of band.events) {
        const uEnd = pe.kind === 'bar' ? base.warp.toU(pe.tEnd) : pe.u
        if (uEnd < d0 || pe.u > d1) continue
        const ev = pe.ev
        let date: string
        let year: number | null = null
        if (isAbsolute(ev.start)) {
          // 年份由日期欄的大字帶出（有勾「年」才寫），小字只寫月、日
          const startYear = parseInt(ev.start.value, 10)
          const small = { ...dateParts, year: false }
          const start = formatPointParts(ev.start, small)
          let end: string | null = null
          if (ev.end && isAbsolute(ev.end)) {
            // 跨年的區間，結束那端要寫出年份，不然讀者會以為是同一年
            const endYear = parseInt(ev.end.value, 10)
            end = formatPointParts(ev.end, { ...small, year: dateParts.year && endYear !== startYear })
          }
          date = end ? `${start}–${end}` : ev.ongoing ? `${start} 起`.trim() : start
          // 起訖太長塞不進日期欄就只寫起點，完整日期在互動版詳情卡裡
          if (estimateTextWidth(date, F.date) > dateColW - 30 * S) date = start
          year = dateParts.year ? startYear : null
        } else {
          // 相對時間：位置是推估的，寫「約」並且不另起年份標題
          date = `約 ${new Date(pe.tStart).getFullYear()}`
        }
        list.push({
          key: `${band.sourceId}/${ev.id}`,
          t: pe.tStart,
          year: Number.isFinite(year) ? year : null,
          date,
          title: ev.title,
          summary: (ev.description ?? '').replace(/\s+/g, ' ').trim(),
          confidence: showConfidence ? confidenceLabel(ev.confidence) : '',
          sourcesText: showSources ? sourcesText(ev.sources) : '',
          trackLabel:
            bands.length > 1 ? ((perDoc.get(band.docTitle) ?? 0) > 1 ? band.trackTitle : band.docTitle) : null,
          color: ev.color ?? band.color,
          isKey: pe.isKey,
          estimate: pe.estimate,
        })
      }
    }
    list.sort((a, b) => a.t - b.t)
    if (reversed) list.reverse()
    return { entries: list, tView: [base.warp.toT(d0), base.warp.toT(d1)] as [number, number] }
  }, [sources, collapseGaps, domain, reversed, dateParts, showConfidence, showSources, theme.palette, F.date, dateColW, S])

  const top = TITLE_H + NOTE_H
  const layout = useMemo(
    () =>
      layoutChronicle(entries, {
        width,
        top,
        bottom: height - FOOTER_H,
        padX,
        dateColW,
        cardPad: 10 * S,
        cardGap: 8 * S,
        titleFont: F.track,
        summaryFont: F.event,
        metaFont: F.footer,
        yearFont: F.title,
        dateFont: F.date,
        lineHeight: 1.4,
      }),
    [entries, width, height, top, FOOTER_H, padX, dateColW, S, F],
  )

  const lastRow = layout.rows[layout.rows.length - 1]
  const spineBottom = lastRow ? lastRow.y + lastRow.h : top

  return (
    <div style={{ width, height, overflow: 'hidden', background: C.bg }}>
      <svg
        id={exportMode.svgId}
        width={width}
        height={height}
        className="block"
        style={{ background: C.bg }}
        data-hidden={layout.hidden}
        // 全部卡片都放得下需要的高度（出圖工作室「自動長度」用）
        data-content-height={Math.ceil(spineBottom + FOOTER_H + 8 * S)}
      >
        {/* 標題區 */}
        <text x={14 * S} y={27 * S} fontSize={F.title} fontWeight={700} fill={C.ink}>
          {fitText(exportMode.title, width - 28 * S, F.title)}
        </text>
        {exportMode.subtitle && (
          <text x={14 * S} y={50 * S} fontSize={F.subtitle} fill={C.inkMuted}>
            {fitText(exportMode.subtitle, width - 28 * S, F.subtitle)}
          </text>
        )}

        {/* 範圍，以及「間距不代表時間長短」的固定說明（誠實原則，不可省略） */}
        <text x={padX} y={TITLE_H + 16 * S} fontSize={F.footer} fill={C.inkFaint}>
          {formatRangeLabel(tView)}
        </text>
        <text x={width - padX} y={TITLE_H + 16 * S} textAnchor="end" fontSize={F.footer} fill={C.inkFaint}>
          依先後排列・卡片間距不代表時間長短
        </text>

        {/* 時間脊線 */}
        {lastRow && (
          <line x1={spineX} x2={spineX} y1={top} y2={spineBottom} stroke={C.axis} strokeWidth={1.5 * S} />
        )}

        {layout.rows.map((row) => {
          const { entry: e, x, y, w, h, titleLines, summaryLines, sourceLines, showYear, dateText } = row
          const pad = 10 * S
          const stripe = 4 * S
          const textX = x + pad + stripe
          const lh = 1.4
          // 文字一行接一行往下排（與 chronicleLayout 算卡片高度的方式一致）
          const titleTop = y + pad
          const summaryTop = titleTop + titleLines.length * F.track * lh
          const metaTop = summaryTop + summaryLines.length * F.event * lh
          const baseline = (top: number, font: number, i: number) => top + font * 1.05 + i * font * lh
          const firstBaseline = baseline(titleTop, F.track, 0)
          const dotY = titleTop + F.track * 0.7
          const dotR = e.isKey ? theme.keyDotR : theme.dotR
          const hasMetaLine = Boolean(e.trackLabel || e.confidence)
          const sourcesTop = metaTop + (hasMetaLine ? F.footer * lh : 0)
          return (
            <g key={e.key}>
              {/* 左欄：新的一年寫大字年份，底下小字月日；圓點在脊線上 */}
              {showYear && (
                <text
                  x={spineX - dotR - 8 * S}
                  y={y + pad + F.title * 0.95}
                  textAnchor="end"
                  fontSize={F.title}
                  fontWeight={700}
                  fill={C.ink}
                >
                  {e.year}
                </text>
              )}
              {dateText && (
                <text
                  x={spineX - dotR - 8 * S}
                  y={showYear ? y + pad + F.title * 0.95 + F.date * 1.4 : firstBaseline}
                  textAnchor="end"
                  fontSize={F.date}
                  fill={C.inkMuted}
                >
                  {dateText}
                </text>
              )}
              {e.isKey && <circle cx={spineX} cy={dotY} r={dotR + 4 * S} fill={e.color} opacity={0.2} />}
              {e.estimate ? (
                <circle
                  cx={spineX}
                  cy={dotY}
                  r={dotR}
                  fill={C.halo}
                  stroke={e.color}
                  strokeWidth={2 * S}
                  strokeDasharray={`${3 * S} ${2.5 * S}`}
                />
              ) : (
                <circle cx={spineX} cy={dotY} r={dotR} fill={e.color} />
              )}

              {/* 卡片 */}
              <rect
                x={x}
                y={y}
                width={w}
                height={h}
                rx={4 * S}
                fill={C.halo}
                stroke={e.isKey ? e.color : C.grid}
                strokeWidth={(e.isKey ? 1.5 : 1) * S}
              />
              <rect x={x} y={y} width={stripe} height={h} fill={e.color} />
              {titleLines.map((line, i) => (
                <text key={`t${i}`} x={textX} y={baseline(titleTop, F.track, i)} fontSize={F.track} fontWeight={700} fill={C.ink}>
                  {line}
                </text>
              ))}
              {summaryLines.map((line, i) => (
                <text key={`s${i}`} x={textX} y={baseline(summaryTop, F.event, i)} fontSize={F.event} fill={C.inkMuted}>
                  {line}
                </text>
              ))}
              {hasMetaLine && (
                <text x={textX} y={baseline(metaTop, F.footer, 0)} fontSize={F.footer} fill={C.inkFaint}>
                  {e.trackLabel && (
                    <tspan fill={e.color} fontWeight={700}>
                      {e.trackLabel}
                    </tspan>
                  )}
                  {e.trackLabel && e.confidence ? ' · ' : ''}
                  {e.confidence}
                </text>
              )}
              {sourceLines.map((line, i) => (
                <text key={`src${i}`} x={textX} y={baseline(sourcesTop, F.footer, i)} fontSize={F.footer} fill={C.inkFaint}>
                  {line}
                </text>
              ))}
            </g>
          )
        })}

        {/* 底部出處（不可省略） */}
        <text x={width - 12 * S} y={height - 8 * S} textAnchor="end" fontSize={F.footer} fill={C.inkFaint}>
          {exportMode.footer}
        </text>
        {/* 底部左側：只列關鍵事件等註記（可在工作室選擇不顯示）。
            放不下的事件不在圖上註明：工作室在有事件放不下時根本不給下載 */}
        {exportMode.note && (
          <text x={padX} y={height - 24 * S} fontSize={F.footer} fill={C.inkFaint}>
            {exportMode.note}
          </text>
        )}
      </svg>
    </div>
  )
}
