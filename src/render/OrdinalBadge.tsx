// render 層：順序等距的「非等比」標示（橫式、直式共用）
//
// 事件依先後等距排列時，間距不代表時間長短。讀者如果不知道，會把「1865→1870」跟
// 「1870→1969」看成一樣久——所以圖的右上角**固定**畫這枚標示，沒有開關（計畫書原則 6：誠實）。

import { estimateTextWidth } from './layout'
import type { RenderTheme } from './theme'

const MAIN = '非等比'
const NOTE = '事件依先後等距排列，間距不代表時間長短'

/** 標示佔的寬度（標題要讓出這麼多空間） */
export function ordinalBadgeWidth(theme: RenderTheme, maxW = Infinity): number {
  const F = theme.font
  const S = theme.scale
  const pad = 8 * S
  const full = estimateTextWidth(MAIN, F.date) + 6 * S + estimateTextWidth(NOTE, F.footer) + pad * 2
  // 太窄的圖只放「非等比」三個字
  return full <= maxW ? full : estimateTextWidth(MAIN, F.date) + pad * 2
}

/** 畫在 (right, top) 往左下展開的標示框 */
export function OrdinalBadge({
  right,
  top,
  theme,
  maxW = Infinity,
}: {
  right: number
  top: number
  theme: RenderTheme
  /** 最多可以多寬；放不下說明就只寫「非等比」 */
  maxW?: number
}) {
  const C = theme.colors
  const F = theme.font
  const S = theme.scale
  const pad = 8 * S
  const w = ordinalBadgeWidth(theme, maxW)
  const withNote = w > estimateTextWidth(MAIN, F.date) + pad * 2 + 1
  const h = F.date + 10 * S
  const x = right - w
  return (
    <g data-ordinal-badge="1">
      <rect x={x} y={top} width={w} height={h} rx={4 * S} fill={C.warnBg} stroke={C.warnLine} strokeWidth={1 * S} />
      <text x={x + pad} y={top + h / 2 + F.date * 0.36} fontSize={F.date} fill={C.warn}>
        <tspan fontWeight={700}>{MAIN}</tspan>
        {withNote && (
          <tspan dx={6 * S} fontSize={F.footer}>
            {NOTE}
          </tspan>
        )}
      </text>
    </g>
  )
}
