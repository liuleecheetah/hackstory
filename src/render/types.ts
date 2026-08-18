// render 層：共用型別
// 這些型別橫式（TimelineView）與直式（VerticalTimelineView）都要用，
// 因此獨立成一個檔案，避免直式檢視反過來 import 橫式檢視。

import type { HstEvent, TimelineDocument } from '../core'

/** 尺度模式（像 Google 日曆的 日/週/月/年 切換） */
export type ScaleMode = 'day' | 'week' | 'month' | 'year'

/** ui 層下的指令：「切到某個尺度」。nonce 遞增代表新的一次點擊 */
export interface ScaleRequest {
  mode: ScaleMode
  nonce: number
}

/** 一份要畫的文件。color 為圖層顏色，覆寫文件內軸線的顏色（用來辨識圖層） */
export interface TimelineSource {
  id: string
  doc: TimelineDocument
  color?: string
  /**
   * 這份文件「本來」是不是多軸（依原始文件，不受暫時隱藏軸線影響）。
   * 決定軸線標題要不要帶軸線名、以及配色以軸線色或圖層色為主。
   * 由 compose 層算好傳入——render 因此不需要知道「有軸線被隱藏」這回事。
   */
  multiTrack?: boolean
  /**
   * 完整文件（含被隱藏軸線的事件），**只用來求解相對時間**。
   *
   * 相對時間是靠「在 A 之後、在 B 之前」推算的。若拿濾掉隱藏軸線的文件去求解，
   * 錨點事件會憑空消失，可見軸線上的相對事件就會突然變成「無法推估」而不見——
   * 但使用者只是隱藏畫面，不該改變事件的時間位置。
   * 沒有隱藏任何軸線時省略即可（等同 doc）。
   */
  fullDoc?: TimelineDocument
}

/** 使用者點選了一個事件：render 層回報給 ui 層，由 ui 顯示詳情卡 */
export interface EventSelection {
  /** 圖層 id + 事件 id 的組合鍵（事件 id 只保證在單一文件內唯一） */
  key: string
  /** 事件所屬的圖層 id（ui 要改事件內容時用） */
  sourceId: string
  event: HstEvent
  docTitle: string
  trackTitle: string
  color: string
  /** 相對時間事件的說明（「在Ａ之後、在Ｂ之前」），絕對時間事件為空 */
  relativeNote?: string | null
  /** 點擊位置（視窗座標），ui 用來決定詳情卡放哪裡 */
  clientX: number
  clientY: number
}

/** 使用者在軸線空白處點兩下：render 層回報位置資訊，由 ui 開「新增事件」表單 */
export interface NewEventDraft {
  sourceId: string
  trackId: string
  docTitle: string
  trackTitle: string
  color: string
  /** 點擊位置對應的日期（如 2024/3/15，交給表單當預設值） */
  dateRaw: string
  clientX: number
  clientY: number
}
