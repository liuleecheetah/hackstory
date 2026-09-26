// render 層：匯出圖片的底部（出處行＋左側註記），三種檢視共用
//
// 出處行不可省略、也不可以被切掉（誠實與可信原則）：寫得比圖還寬時自動換行，
// 底部跟著加高，而不是讓字跑出畫面。註記（例如「僅列關鍵事件」）放在出處行上面一行。

import { wrapLines } from './layout'
import type { RenderTheme } from './theme'

/** 一行出處小字佔多高 */
const lineH = (theme: RenderTheme) => theme.font.footer * 1.4

/** 出處行折成幾行（最多四行，再長就真的太長了，最後一行以「…」收尾） */
export function footerLines(footer: string, width: number, theme: RenderTheme): string[] {
  const S = theme.scale
  return wrapLines(footer, Math.max(40, width - 24 * S), theme.font.footer, 4)
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
): number {
  const extraLines = footerLines(footer, width, theme).length - 1
  return base + extraLines * lineH(theme) + (note ? 16 * theme.scale : 0)
}

export function ExportFooter({
  footer,
  note,
  width,
  height,
  noteX,
  theme,
}: {
  footer: string
  note?: string
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
  return (
    <>
      {/* 左側註記（例如只列了關鍵事件），誠實告訴讀者這是精選 */}
      {note && (
        <text x={noteX} y={firstY - 16 * S} fontSize={F.footer} fill={C.inkFaint}>
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
