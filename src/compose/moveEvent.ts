// compose 層：把事件搬到另一個圖層（另一份時間軸檔）的另一條軸線（純函式）
//
// 同一個圖層內換軸線只是改 event.track，不需要這裡。跨圖層要處理的事：
// - 相對時間的事件（「在某事件之後」）時間要靠原圖層的其他事件推算，搬過去就失去依據 → 不給搬
// - 原圖層裡有其他事件的相對時間以它為參考 → 搬走會讓它們失去依據 → 不給搬
// - 原圖層裡連到它的關係線無法跨檔案保留（跨檔案連線是 Phase 2）→ 拿掉，事先列出來讓使用者確認
// - 目標圖層裡剛好有同樣 id 的事件 → 換一個 id

import type { HstEvent, Relation, TimelineDocument } from '../core'
import { isAbsolute, removeEventFromDocument, sameDocumentRelations } from '../core'

export type MovePlan =
  | {
      ok: true
      source: TimelineDocument
      target: TimelineDocument
      /** 搬走後會拿掉的關係線（原圖層裡連到這件事的） */
      droppedRelations: Relation[]
      /** 在目標圖層裡的 id（撞名時會換） */
      newId: string
    }
  | { ok: false; reason: string }

/** 規格版本：取兩份裡比較新的，搬過去的欄位在目標檔案裡才合法 */
function newerVersion(a: string, b: string): string {
  const parse = (v: string) => (/^(\d+)\.(\d+)$/.exec(v) ?? []).slice(1).map(Number)
  const [a1 = 0, a2 = 0] = parse(a)
  const [b1 = 0, b2 = 0] = parse(b)
  return a1 > b1 || (a1 === b1 && a2 >= b2) ? a : b
}

/**
 * 規劃一次跨圖層搬移。event 是「已套用編輯」的版本（id 與原本相同），targetTrackId 是目標圖層的軸線
 */
export function planMoveEvent(
  source: TimelineDocument,
  target: TimelineDocument,
  event: HstEvent,
  targetTrackId: string,
): MovePlan {
  if (!target.tracks.some((t) => t.id === targetTrackId)) {
    return { ok: false, reason: '目標軸線不存在' }
  }
  if (!isAbsolute(event.start)) {
    return {
      ok: false,
      reason: '這件事用的是相對時間（「在某事件之後／之前」），時間要靠原圖層的其他事件推算，搬到別的圖層就失去依據——請先改成確切日期再搬',
    }
  }
  const removal = removeEventFromDocument(source, event.id)
  const dependents = [...removal.cascadeRemoved, ...removal.referencesCleaned]
  if (dependents.length > 0) {
    return {
      ok: false,
      reason: `原圖層有 ${dependents.length} 件事的時間是以這件事為參考（${dependents
        .slice(0, 3)
        .map((e) => `「${e.title}」`)
        .join('、')}${dependents.length > 3 ? '…' : ''}），搬走會讓它們失去依據——請先改它們的時間`,
    }
  }
  const droppedRelations = sameDocumentRelations(source.relations).filter(
    (r) => r.from === event.id || r.to === event.id,
  )
  const used = new Set(target.events.map((e) => e.id))
  let newId = event.id
  for (let n = 2; used.has(newId); n++) newId = `${event.id}-${n}`
  const moved: HstEvent = { ...event, id: newId, track: targetTrackId }
  return {
    ok: true,
    source: removal.doc,
    target: {
      ...target,
      hackstory: newerVersion(target.hackstory, source.hackstory),
      events: [...target.events, moved],
    },
    droppedRelations,
    newId,
  }
}
