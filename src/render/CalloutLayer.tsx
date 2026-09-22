// render 層：畫標註框（橫式、直式共用）
//
// 位置由 callouts.ts 算好；這裡只負責畫：引線從事件連到框的最近一點、框裡寫標題與摘要。

import type { PlacedCallout } from './callouts'
import type { RenderTheme } from './theme'

export function CalloutLayer({ placed, theme }: { placed: PlacedCallout[]; theme: RenderTheme }) {
  const C = theme.colors
  const F = theme.font
  const S = theme.scale
  const pad = 8 * S
  const lh = 1.35
  return (
    <g pointerEvents="none">
      {placed.map((p) => {
        // 引線接到框上離事件最近的一點
        const ex = Math.min(Math.max(p.anchorX, p.x), p.x + p.w)
        const ey = Math.min(Math.max(p.anchorY, p.y), p.y + p.h)
        const titleTop = p.y + pad
        const summaryTop = titleTop + p.titleLines.length * F.event * lh
        return (
          <g key={p.key}>
            <line x1={p.anchorX} y1={p.anchorY} x2={ex} y2={ey} stroke={C.inkMuted} strokeWidth={1 * S} />
            <circle cx={p.anchorX} cy={p.anchorY} r={2.5 * S} fill={C.inkMuted} />
            <rect
              x={p.x}
              y={p.y}
              width={p.w}
              height={p.h}
              rx={4 * S}
              fill={C.calloutBg}
              stroke={C.axis}
              strokeWidth={1 * S}
            />
            {p.titleLines.map((line, i) => (
              <text
                key={`t${i}`}
                x={p.x + pad}
                y={titleTop + F.event * 1.0 + i * F.event * lh}
                fontSize={F.event}
                fontWeight={700}
                fill={C.ink}
              >
                {line}
              </text>
            ))}
            {p.summaryLines.map((line, i) => (
              <text
                key={`s${i}`}
                x={p.x + pad}
                y={summaryTop + F.date * 1.0 + i * F.date * lh}
                fontSize={F.date}
                fill={C.inkMuted}
              >
                {line}
              </text>
            ))}
          </g>
        )
      })}
    </g>
  )
}

/** 標註框排版用的尺寸（兩種檢視共用，隨主題倍率縮放） */
export function calloutMetrics(theme: RenderTheme, maxLeader: number, boxW = 200) {
  const S = theme.scale
  return {
    boxW: boxW * S,
    pad: 8 * S,
    titleFont: theme.font.event,
    summaryFont: theme.font.date,
    lineHeight: 1.35,
    gap: 10 * S,
    maxLeader,
  }
}
