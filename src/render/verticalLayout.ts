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

/** 一欄的位置。mirrored = 這一欄貼著中央刻度尺、圖形靠右、文字往左長 */
export interface VerticalColumn {
  x: number
  w: number
  mirrored: boolean
}

/** columns 模式：刻度尺在最左邊，每欄依序往右排 */
export function columnRects(containerWidth: number, bandCount: number): VerticalColumn[] {
  if (bandCount <= 0) return []
  const available = Math.max(0, containerWidth - RULER_W)
  const w = available / bandCount
  return Array.from({ length: bandCount }, (_, i) => ({
    x: RULER_W + i * w,
    w,
    mirrored: false,
  }))
}

/**
 * 對照模式：刻度尺移到畫面正中央，軸線平均分到左右兩側。
 *
 * 左側那幾欄是**鏡像**的——圖形貼著中央的刻度尺、標題往左邊長出去，
 * 這樣左右兩邊的事件都緊鄰同一根時間軸，同一個高度就是同一個時間，一眼就能對照。
 */
export function centerColumnRects(
  containerWidth: number,
  bandCount: number,
): { rulerX: number; columns: VerticalColumn[] } {
  if (bandCount <= 0) return { rulerX: 0, columns: [] }
  const side = Math.max(0, (containerWidth - RULER_W) / 2)
  const leftCount = Math.floor(bandCount / 2)
  const rightCount = bandCount - leftCount
  const columns: VerticalColumn[] = []
  // 左側：由外往內排，最後一欄貼著刻度尺
  if (leftCount > 0) {
    const w = side / leftCount
    for (let i = 0; i < leftCount; i++) columns.push({ x: i * w, w, mirrored: true })
  }
  // 右側：由刻度尺往外排
  if (rightCount > 0) {
    const w = side / rightCount
    for (let i = 0; i < rightCount; i++) {
      columns.push({ x: side + RULER_W + i * w, w, mirrored: false })
    }
  }
  return { rulerX: side, columns }
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
 * 標題堆疊：由上往下排，保證相鄰兩個標題至少相隔 slotH，回傳每個標題實際的 y。
 *
 * 副車道（往右錯開）只能讓「圖形」不重疊——標題有一百多像素寬，
 * 錯開十幾像素完全不夠。所以文字改用堆疊：圓點留在真正的時間位置，
 * 標題被往下擠，中間畫一條細線把兩者接起來。
 *
 * **但擠是有上限的。** 一旦某個標題得離自己的時間位置超過 maxDrift 才排得下，
 * 就回傳 null（這一列不畫標題，只留圓點）——寧可不畫，也不要讓讀者
 * 以為那件事發生在別的年代。呼叫端要負責告訴使用者有幾件沒顯示。
 *
 * naturalY 需先由小到大排序。
 */
export function stackLabels(
  naturalY: number[],
  slotH = 18,
  maxDrift = Infinity,
): Array<number | null> {
  let cursor = -Infinity
  return naturalY.map((y) => {
    const placed = Math.max(y, cursor)
    if (placed - y > maxDrift) return null
    cursor = placed + slotH
    return placed
  })
}

/** 依上面的規則，有幾個標題會排不下（用來決定這條軸要多長） */
export function countDroppedLabels(
  naturalY: number[],
  slotH = 18,
  maxDrift = Infinity,
): number {
  return stackLabels(naturalY, slotH, maxDrift).filter((y) => y === null).length
}

/**
 * 決定整條軸的內容高度：從最短開始，只要還有標題排不下就把軸拉長，
 * 直到全部排得下為止（或碰到上限——碰到上限就會有事件只剩圓點，
 * 呼叫端要在畫面上標示「還有 N 件」）。
 *
 * columns：每一欄事件的相對位置（0＝最早，1＝最晚），需已排序。
 */
export function fitContentHeight(
  columns: number[][],
  {
    minH = 520,
    maxH = 12_000,
    slotH = 18,
    maxDrift = 26,
  }: { minH?: number; maxH?: number; slotH?: number; maxDrift?: number } = {},
): number {
  let h = minH
  for (;;) {
    const dropped = columns.reduce(
      (acc, positions) =>
        acc + countDroppedLabels(positions.map((p) => p * h), slotH, maxDrift),
      0,
    )
    if (dropped === 0 || h >= maxH) return Math.min(h, maxH)
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

/**
 * 畫面上**真正看得到**的那一段時間（壓縮座標 u）。
 *
 * 直式的整條軸比視窗高很多，靠捲動閱讀——所以「目前範圍」不等於整條軸的範圍。
 * 左上角的範圍標籤要用這個算，否則標籤會說謊（寫著 1855–2030，眼前其實是 1856–1868）。
 */
export function visibleURange(
  uAt: (y: number) => number,
  scrollTop: number,
  viewportH: number,
  domain: [number, number],
): [number, number] {
  const [d0, d1] = domain
  const clamp = (u: number) => Math.min(Math.max(u, d0), d1)
  const a = clamp(uAt(scrollTop))
  const b = clamp(uAt(scrollTop + viewportH))
  // 反轉時間方向時上面是「晚」、下面是「早」，回傳的範圍一律由小到大
  return a <= b ? [a, b] : [b, a]
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
