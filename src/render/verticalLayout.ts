// render 層：直式時間軸的排版計算（純函式，沒有畫面、沒有 React）
//
// 直式不是把橫式轉 90 度：文字仍然是橫的，所以每個事件天然擁有一整行寬度，
// 適合閱讀。時間由上往下流，多條軸線變成左右並排的欄。
//
// 這裡只回答三個問題：
//   1. 這個寬度放得下幾欄？放不下就改成單欄合流
//   2. 每一欄從哪裡開始、多寬？
//   3. 同一欄裡上下打架的事件，誰要往右錯開？

import { assignLanes, estimateTextWidth } from './layout'

/** 左側刻度尺的寬度 */
export const RULER_W = 64
/** 一欄至少要有這麼寬，中文標題才讀得下去（約 12 個全形字） */
export const MIN_COL_W = 180

/** 直式的兩種排法 */
export type VerticalMode = 'columns' | 'merged'

/**
 * 依容器寬度決定排法：欄夠寬 → 多欄並排；不夠 → 單欄合流（事件按時間混排）。
 * 手機直握時通常會落在 merged。
 */
export function pickVerticalMode(containerWidth: number, bandCount: number): VerticalMode {
  if (bandCount <= 0) return 'columns'
  return (containerWidth - RULER_W) / bandCount >= MIN_COL_W ? 'columns' : 'merged'
}

/** columns 模式：算出每欄的 x 起點與寬度（加總剛好等於扣掉刻度尺後的可用寬度） */
export function columnRects(
  containerWidth: number,
  bandCount: number,
): Array<{ x: number; w: number }> {
  if (bandCount <= 0) return []
  const available = Math.max(0, containerWidth - RULER_W)
  const w = available / bandCount
  return Array.from({ length: bandCount }, (_, i) => ({ x: RULER_W + i * w, w }))
}

/** 一個事件在垂直方向佔掉的範圍（含它的標題那一行） */
export interface VerticalSlot {
  top: number
  bottom: number
}

/**
 * 欄內事件的水平副車道：兩個事件時間太近、標題上下打架時，往右錯開。
 * 直接重用橫式的車道演算法——車道分配與方向無關，只是這裡餵進去的是垂直區間。
 * 需先依 top 排序。
 */
export function verticalLanes(slots: VerticalSlot[], gap = 2): number[] {
  return assignLanes(
    slots.map((s) => ({ left: s.top, right: s.bottom })),
    gap,
  )
}

/**
 * 標籤堆疊：由上往下排，保證相鄰兩個標題至少相隔 slotH，回傳每個標題實際的 y。
 *
 * 副車道（往右錯開）只能讓「圖形」不重疊——標題有一百多像素寬，
 * 錯開十幾像素完全不夠。所以文字改用堆疊：圓點留在真正的時間位置，
 * 標題被往下擠，中間畫一條細線把兩者接起來。
 *
 * naturalY 需先由小到大排序。
 */
export function stackLabels(naturalY: number[], slotH = 18): number[] {
  let cursor = -Infinity
  return naturalY.map((y) => {
    const placed = Math.max(y, cursor)
    cursor = placed + slotH
    return placed
  })
}

/** 堆疊後標題離真實時間位置最遠差了多少（用來判斷這條軸夠不夠長） */
export function maxLabelDrift(naturalY: number[], slotH = 18): number {
  const placed = stackLabels(naturalY, slotH)
  let worst = 0
  for (let i = 0; i < placed.length; i++) worst = Math.max(worst, placed[i] - naturalY[i])
  return worst
}

/**
 * 決定整條軸的內容高度：從最短開始，只要有標題被擠得離真實位置太遠就把軸拉長，
 * 直到「看到的位置」與「真正的時間」夠接近為止（或碰到上限）。
 *
 * columns：每一欄事件的相對位置（0＝最早，1＝最晚），需已排序。
 */
export function fitContentHeight(
  columns: number[][],
  {
    minH = 520,
    maxH = 12_000,
    slotH = 18,
    maxDrift = 24,
  }: { minH?: number; maxH?: number; slotH?: number; maxDrift?: number } = {},
): number {
  let h = minH
  for (;;) {
    const worst = columns.reduce(
      (acc, positions) => Math.max(acc, maxLabelDrift(positions.map((p) => p * h), slotH)),
      0,
    )
    if (worst <= maxDrift || h >= maxH) return Math.min(h, maxH)
    h = Math.min(maxH, h * 1.35)
  }
}

/**
 * 一欄裡「圖形區」要留多寬：所有事件（含往右錯開的副車道）佔掉的最大寬度。
 *
 * 圖形與標題必須分屬兩個互不侵犯的區域，否則錯開的圓點會壓到隔壁事件的標題上。
 * 算出這個寬度後，整欄的標題就從同一個 x 開始排——順便讓文字對齊，好讀很多。
 */
export function shapeGutter(
  items: Array<{ lane: number; width: number }>,
  step: number,
): number {
  return items.reduce((max, it) => Math.max(max, it.lane * step + it.width), 0)
}

/** 依可用寬度截斷文字（欄寬有限，完整標題到詳情卡看） */
export function fitText(text: string, maxWidth: number, fontSize = 12): string {
  if (maxWidth <= 0) return ''
  if (estimateTextWidth(text, fontSize) <= maxWidth) return text
  const ellipsisW = estimateTextWidth('…', fontSize)
  let used = 0
  let kept = 0
  for (const ch of text) {
    const w = estimateTextWidth(ch, fontSize)
    if (used + w + ellipsisW > maxWidth) break
    used += w
    kept++
  }
  return [...text].slice(0, kept).join('') + '…'
}
