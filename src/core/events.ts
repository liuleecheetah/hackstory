// core 層：事件的語意判斷輔助
// 「這則事件是不是作者選出的重點」只在這裡定義一次，其他層一律呼叫這個函式，
// 不要各自寫 featured === true / importance >= 5——同一個概念多種寫法遲早會不一致。

import type { HstEvent } from './types'

/**
 * 舊欄位 importance 用來表示「突出」的門檻值（0.3 之前的檔案）。
 * 0.3 起改用布林的 featured；這個常數只為了相容讀取舊檔而存在。
 */
export const LEGACY_FEATURED_IMPORTANCE = 5

/**
 * 這則事件是不是「作者選來優先呈現的重點」（featured）。
 *
 * 語意是**編輯選擇**，不是客觀分數：表達「這份時間軸的作者希望讀者優先注意這則」，
 * 而不是「這則客觀上有幾分重要」。見 SPEC 第 6 節。
 *
 * 相容舊檔：沒有 featured 欄位時，退回看舊的 importance（>= 5 視為重點）。
 * 兩者都有時以 featured 為準（驗證器會另外提出警告）。
 */
export function isFeatured(event: Pick<HstEvent, 'featured' | 'importance'>): boolean {
  if (event.featured !== undefined) return event.featured === true
  return (event.importance ?? 0) >= LEGACY_FEATURED_IMPORTANCE
}
