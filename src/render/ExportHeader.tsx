// render 層：匯出圖片頂部的標題與副標（三種檢視共用）
//
// 標題、副標太長時不再默默變成「…」：各自最多換成兩行，標題列跟著加高。
// 兩行還放不下才截短，並回報 truncated，讓出圖工作室在輸入框旁提醒使用者。
// 只有一行時的位置與高度跟以前完全一樣。

import { wrapLines } from './layout'
import type { RenderTheme } from './theme'

/** 標題、副標各最多幾行 */
const MAX_LINES = 2

export interface ExportHeaderLayout {
  titleLines: string[]
  subtitleLines: string[]
  /** 標題列總高（含上下留白） */
  height: number
  /** 兩行還放不下、被截短了 */
  titleTruncated: boolean
  subtitleTruncated: boolean
}

/**
 * 排標題列。reserveRight：右上角要讓出多寬（例如順序等距的「非等比」標示），
 * 只影響標題；副標在標示下方，寬度照常。
 */
export function layoutExportHeader(
  title: string,
  subtitle: string | undefined,
  width: number,
  theme: RenderTheme,
  reserveRight = 0,
): ExportHeaderLayout {
  const S = theme.scale
  const F = theme.font
  const textW = Math.max(40, width - 28 * S)
  const titleAll = wrapLines(title, textW - reserveRight, F.title, 99)
  const subAll = subtitle ? wrapLines(subtitle, textW, F.subtitle, 99) : []
  const titleLines = wrapLines(title, textW - reserveRight, F.title, MAX_LINES)
  const subtitleLines = subtitle ? wrapLines(subtitle, textW, F.subtitle, MAX_LINES) : []
  const extra =
    Math.max(0, titleLines.length - 1) * titleLineH(theme) +
    Math.max(0, subtitleLines.length - 1) * subtitleLineH(theme)
  return {
    titleLines,
    subtitleLines,
    height: (subtitleLines.length > 0 ? 64 : 42) * S + extra,
    titleTruncated: titleAll.length > MAX_LINES,
    subtitleTruncated: subAll.length > MAX_LINES,
  }
}

const titleLineH = (t: RenderTheme) => t.font.title * 1.3
const subtitleLineH = (t: RenderTheme) => t.font.subtitle * 1.35

export function ExportHeader({ layout, x, theme }: { layout: ExportHeaderLayout; x: number; theme: RenderTheme }) {
  const S = theme.scale
  const F = theme.font
  const C = theme.colors
  const tl = titleLineH(theme)
  const sl = subtitleLineH(theme)
  // 第一行標題的基線與以前相同（27）；副標跟在最後一行標題下面
  const subTop = 50 * S + Math.max(0, layout.titleLines.length - 1) * tl
  return (
    <>
      <text x={x} y={27 * S} fontSize={F.title} fontWeight={700} fill={C.ink}>
        {layout.titleLines.map((line, i) => (
          <tspan key={i} x={x} dy={i === 0 ? 0 : tl}>
            {line}
          </tspan>
        ))}
      </text>
      {layout.subtitleLines.length > 0 && (
        <text x={x} y={subTop} fontSize={F.subtitle} fill={C.inkMuted}>
          {layout.subtitleLines.map((line, i) => (
            <tspan key={i} x={x} dy={i === 0 ? 0 : sl}>
              {line}
            </tspan>
          ))}
        </text>
      )}
    </>
  )
}
