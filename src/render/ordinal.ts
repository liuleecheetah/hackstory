// render 層：順序等距（出圖工作室的選項）
//
// 少量精選事件照時間比例排，常常擠在一端、另一端大片空白。
// 順序等距把每個「相異的時間點」平均放在等距的格子上：第 1 個時間點在第 1 格、第 2 個在第 2 格……
// 格子之間線性內插（區間長條的結尾、使用者指定的起訖年份會落在兩格之間）。
//
// 它跟 gaps.ts 的空白摺疊是同一個介面（TimeWarp：真實時間 t ↔ 座標 u）的另一種實作，
// 所以繪製端不必知道兩者的差別——只有刻度與「非等比」標示要看 ordinalSlots 換個畫法。
// 圖上**必須**標示「非等比」（計畫書原則 6：誠實），不可關閉。

import type { TimeWarp } from './gaps'

/** 一格的寬度（座標 u）。取一年的毫秒數，讓 u 的數量級跟平常的時間座標差不多 */
export const ORDINAL_STEP = 365.25 * 24 * 3_600_000

/**
 * 從事件的時間點建立順序等距的對應。
 * times：每個事件畫在軸上的時間（毫秒），重複的時間點共用一格。
 * 第一格在 u = 0，第 i 格在 u = i × ORDINAL_STEP。
 */
export function buildOrdinalWarp(times: number[]): TimeWarp {
  const slots = [...new Set(times.filter(Number.isFinite))].sort((a, b) => a - b)
  const n = slots.length
  if (n === 0) {
    return { toU: (t) => t, toT: (u) => u, gaps: [], active: false, ordinalSlots: [] }
  }
  // 頭尾之外（例如長條的結尾、自訂年份比第一件事件早）：用平均間隔往外延伸，保持嚴格遞增、可反推
  const avgGap = n > 1 ? (slots[n - 1] - slots[0]) / (n - 1) : ORDINAL_STEP
  const outSlope = ORDINAL_STEP / (avgGap > 0 ? avgGap : ORDINAL_STEP)

  const toU = (t: number): number => {
    if (t <= slots[0]) return (t - slots[0]) * outSlope
    if (t >= slots[n - 1]) return (n - 1) * ORDINAL_STEP + (t - slots[n - 1]) * outSlope
    // 找 t 落在哪兩格之間（二分搜尋）
    let lo = 0
    let hi = n - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (slots[mid] <= t) lo = mid
      else hi = mid
    }
    return (lo + (t - slots[lo]) / (slots[hi] - slots[lo])) * ORDINAL_STEP
  }

  const toT = (u: number): number => {
    const last = (n - 1) * ORDINAL_STEP
    if (u <= 0) return slots[0] + u / outSlope
    if (u >= last) return slots[n - 1] + (u - last) / outSlope
    const i = Math.floor(u / ORDINAL_STEP)
    const f = u / ORDINAL_STEP - i
    return slots[i] + f * (slots[i + 1] - slots[i])
  }

  return { toU, toT, gaps: [], active: true, ordinalSlots: slots }
}

/** 順序等距時的初始可視範圍：第一格前、最後一格後各留大半格 */
export function ordinalDomain(warp: TimeWarp): [number, number] {
  const n = warp.ordinalSlots?.length ?? 0
  return [-0.6 * ORDINAL_STEP, (Math.max(n, 1) - 1 + 0.6) * ORDINAL_STEP]
}

/**
 * 格子的刻度文字：每格寫年份，跟前一個寫出來的年份相同就不重寫（事件旁已有完整日期）。
 * minGap：兩個刻度文字之間至少隔多遠（像素），太擠就跳過。
 */
export function ordinalTicks(
  slots: number[],
  posOf: (t: number) => number,
  minGap: number,
): Array<{ t: number; pos: number; label: string }> {
  const out: Array<{ t: number; pos: number; label: string }> = []
  let lastPos = -Infinity
  let lastLabel = ''
  for (const t of slots) {
    const pos = posOf(t)
    const label = String(new Date(t).getFullYear())
    if (label === lastLabel || Math.abs(pos - lastPos) < minGap) continue
    out.push({ t, pos, label })
    lastPos = pos
    lastLabel = label
  }
  return out
}
