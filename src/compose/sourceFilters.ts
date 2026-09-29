// compose 層：出圖時「呈現哪些事件」的篩選
//
// 篩選是「挑哪些資料來畫」，屬於組合圖層的工作；render 拿到的就是該畫的事件，
// 不需要知道「只放關鍵事件」這回事（分層鐵律）。

import { isFeatured, sameDocumentRelations } from '../core'
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

/**
 * 只留下「有關係線連到另一件也在圖上的事件」的事件。
 *
 * 兩端都要在圖上才算：另一端的軸線被隱藏、或落在時間範圍外，這條線就畫不出來，
 * 留著它只會出現「說有關係、圖上卻沒有線」的事件。
 * shown：這件事件會不會出現在圖上（例如在不在時間範圍內）；沒給就是文件裡現有的事件都算。
 * 跨文件的關係線還沒實作（Phase 2），不算。
 */
export function linkedOnly(
  sources: TimelineSource[],
  shown: (sourceId: string, eventId: string) => boolean = () => true,
): TimelineSource[] {
  return sources.map((s) => {
    const present = new Set(s.doc.events.filter((e) => shown(s.id, e.id)).map((e) => e.id))
    const linked = new Set<string>()
    for (const r of sameDocumentRelations(s.doc.relations)) {
      if (r.from !== r.to && present.has(r.from) && present.has(r.to)) {
        linked.add(r.from)
        linked.add(r.to)
      }
    }
    return {
      ...s,
      doc: { ...s.doc, events: s.doc.events.filter((e) => linked.has(e.id)) },
      fullDoc: s.fullDoc ?? s.doc,
    }
  })
}
