// render 層：匯出圖片的底部（出處行＋左側註記），三種檢視共用
//
// 出處行不可省略、也不可以被切掉（誠實與可信原則）：寫得比圖還寬時自動換行，
// 底部跟著加高，而不是讓字跑出畫面。註記（例如「僅列關鍵事件」）放在出處行上面一行。

import { estimateTextWidth, wrapLines } from './layout'
import type { RenderTheme } from './theme'
import { RELATION_LABELS, relationDash } from './timelineData'

/** 一行出處小字佔多高 */
const lineH = (theme: RenderTheme) => theme.font.footer * 1.4

/** 出處行折成幾行（最多四行，再長就真的太長了，最後一行以「…」收尾） */
export function footerLines(footer: string, width: number, theme: RenderTheme): string[] {
  const S = theme.scale
  return wrapLines(footer, Math.max(40, width - 24 * S), theme.font.footer, 4)
}

/** 圖例一排的高度 */
const legendRowH = (theme: RenderTheme) => 16 * theme.scale

/**
 * 關係線圖例：「關係線：——導致　– – 回應 …」，一排放不下就換排。
 * 回傳每一排的項目與 x 位置。
 */
export function legendRows(
  types: string[],
  width: number,
  theme: RenderTheme,
): Array<Array<{ type: string; x: number }>> {
  if (types.length === 0) return []
  const S = theme.scale
  const F = theme.font
  const sampleW = 22 * S
  const left = 12 * S
  const right = width - 12 * S
  const prefixW = estimateTextWidth('關係線：', F.footer) + 4 * S
  const rows: Array<Array<{ type: string; x: number }>> = [[]]
  let x = left + prefixW
  for (const type of types) {
    const w = sampleW + 4 * S + estimateTextWidth(RELATION_LABELS[type] ?? type, F.footer)
    if (rows[rows.length - 1].length > 0 && x + w > right) {
      rows.push([])
      x = left + prefixW
    }
    rows[rows.length - 1].push({ type, x })
    x += w + 12 * S
  }
  return rows
}

/**
 * 底部要留多高。base：一行出處時原本留的高度（各檢視沿用自己的數字，
 * 只有一行、沒有註記時跟以前完全一樣）。
 */
export function exportFooterHeight(
  base: number,
  footer: string,
  note: string | undefined,
  width: number,
  theme: RenderTheme,
  /** 圖上有畫的關係類型（沒有就不畫圖例） */
  legend: string[] = [],
): number {
  const extraLines = footerLines(footer, width, theme).length - 1
  return (
    base +
    extraLines * lineH(theme) +
    (note ? 16 * theme.scale : 0) +
    legendRows(legend, width, theme).length * legendRowH(theme)
  )
}

export function ExportFooter({
  footer,
  note,
  width,
  height,
  noteX,
  theme,
  legend = [],
}: {
  footer: string
  note?: string
  /** 圖上有畫的關係類型：畫成圖例，讀者才看得懂每條線的意思 */
  legend?: string[]
  width: number
  height: number
  /** 註記的左邊界（各檢視的內距不同） */
  noteX: number
  theme: RenderTheme
}) {
  const S = theme.scale
  const F = theme.font
  const C = theme.colors
  const lines = footerLines(footer, width, theme)
  const lh = lineH(theme)
  // 最後一行貼著底部，往上一行一行排
  const lastY = height - 8 * S
  const firstY = lastY - (lines.length - 1) * lh
  const noteY = firstY - 16 * S
  const rows = legendRows(legend, width, theme)
  // 圖例在註記（或出處行）的上面，由下往上排
  const legendBottomY = (note ? noteY : firstY) - 16 * S
  const sampleW = 22 * S
  return (
    <>
      {rows.map((row, r) => {
        const y = legendBottomY - (rows.length - 1 - r) * legendRowH(theme)
        const midY = y - F.footer * 0.35
        return (
          <g key={`legend-${r}`} data-relation-legend="1">
            {r === 0 && (
              <text x={12 * S} y={y} fontSize={F.footer} fill={C.inkMuted}>
                關係線：
              </text>
            )}
            {row.map(({ type, x }) => (
              <g key={type}>
                <line
                  x1={x}
                  x2={x + sampleW - 4 * S}
                  y1={midY}
                  y2={midY}
                  stroke={C.inkMuted}
                  strokeWidth={1.5 * S}
                  strokeDasharray={relationDash(type, S)}
                  strokeLinecap={type === 'derives_from' ? 'round' : undefined}
                />
                {/* 箭頭：由前因指向後果 */}
                <path
                  d={`M ${x + sampleW - 5 * S} ${midY - 3 * S} L ${x + sampleW} ${midY} L ${x + sampleW - 5 * S} ${midY + 3 * S} z`}
                  fill={C.inkMuted}
                />
                <text x={x + sampleW + 4 * S} y={y} fontSize={F.footer} fill={C.inkMuted}>
                  {RELATION_LABELS[type] ?? type}
                </text>
              </g>
            ))}
          </g>
        )
      })}
      {/* 左側註記（例如只列了關鍵事件），誠實告訴讀者這是精選 */}
      {note && (
        <text x={noteX} y={noteY} fontSize={F.footer} fill={C.inkFaint}>
          {note}
        </text>
      )}
      {/* 出處小字：靠右，放不下就換行 */}
      <text x={width - 12 * S} y={firstY} textAnchor="end" fontSize={F.footer} fill={C.inkFaint}>
        {lines.map((line, i) => (
          <tspan key={i} x={width - 12 * S} dy={i === 0 ? 0 : lh}>
            {line}
          </tspan>
        ))}
      </text>
    </>
  )
}
