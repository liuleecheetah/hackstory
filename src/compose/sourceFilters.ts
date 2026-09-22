// compose 層：出圖時「呈現哪些事件」的篩選
//
// 篩選是「挑哪些資料來畫」，屬於組合圖層的工作；render 拿到的就是該畫的事件，
// 不需要知道「只放關鍵事件」這回事（分層鐵律）。

import { isFeatured } from '../core'
import type { TimelineSource } from '../render/types'

/**
 * 只留下關鍵事件（featured）。
 * 完整文件照樣附在 fullDoc：相對時間要靠所有錨點才推算得準，
 * 篩掉的事件只是不畫，不該讓留下來的事件位置跑掉。
 */
export function featuredOnly(sources: TimelineSource[]): TimelineSource[] {
  return sources.map((s) => ({
    ...s,
    doc: { ...s.doc, events: s.doc.events.filter(isFeatured) },
    fullDoc: s.fullDoc ?? s.doc,
  }))
}
