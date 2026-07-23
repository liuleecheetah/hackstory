// core 層：事件的語意判斷輔助
// 「這則事件是不是作者選出的重點」只在這裡定義一次，其他層一律呼叫這個函式，
// 不要各自寫 featured === true——同一個概念多種寫法遲早會不一致。

import type { HstEvent } from './types'

/**
 * 這則事件是不是「作者選來優先呈現的重點」（featured）。
 *
 * 語意是**編輯選擇**，不是客觀分數：表達「這份時間軸的作者希望讀者優先注意這則」，
 * 而不是「這則客觀上有幾分重要」。見 SPEC 第 6 節。
 */
export function isFeatured(event: Pick<HstEvent, 'featured'>): boolean {
  return event.featured === true
}
