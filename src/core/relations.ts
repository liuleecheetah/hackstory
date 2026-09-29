// core 層：關係的語意判斷輔助
// 「這條關係是不是跨文件的」只在這裡定義一次，其他層一律呼叫這個函式。
// 事件 id 只保證在「同一份文件內」唯一，所以光看 from／to 的字串無法分辨
// 它指的是本文件的事件、還是別份文件裡剛好同名的事件——必須看 fromDoc／toDoc。

import { absolutePointRange } from './time'
import type { HstEvent, Relation, RelationType } from './types'
import { isAbsolute } from './types'

/**
 * 這條關係是否指向其他文件（SPEC 0.4 的 fromDoc／toDoc）。
 *
 * 跨文件關係的繪製屬 Phase 2，**目前一律略過**：不畫線、不列進說明、不寫進匯出。
 * 若不明確略過，當外部事件 id 剛好與本文件某事件相同時，
 * 會畫出一條指向錯誤事件的關係線——比不畫更糟。
 */
export function isCrossDocument(rel: Pick<Relation, 'fromDoc' | 'toDoc'>): boolean {
  return rel.fromDoc !== undefined || rel.toDoc !== undefined
}

/** 只取「本文件內」的關係。目前所有繪製與匯出都應該用這個，而不是直接讀 doc.relations */
export function sameDocumentRelations(relations: Relation[] | undefined): Relation[] {
  return (relations ?? []).filter((r) => !isCrossDocument(r))
}

/**
 * 產生一個在這份文件內不重複的關係 id。
 * 與事件 id 同樣的寫法（前綴＋時間戳），但額外確保不會撞到匯入檔案裡既有的 id。
 */
export function nextRelationId(relations: Relation[] | undefined): string {
  const used = new Set(
    (relations ?? []).map((r) => r.id).filter((id): id is string => id !== undefined),
  )
  const base = `rel-${Date.now().toString(36)}`
  if (!used.has(base)) return base
  let n = 2
  while (used.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}

/**
 * 從關係清單中移除指定的一條。
 *
 * **為什麼不用陣列索引：** 索引會因為其他編輯、復原／重做而位移，
 * 畫面上記住的位置可能已經指向別條關係，一按就刪錯。
 * 有 id 就依 id（穩定）；舊資料沒有 id 時退回比對內容，且只移除第一筆相符的。
 */
export function removeRelationFrom(relations: Relation[], target: Relation): Relation[] {
  if (target.id !== undefined) {
    return relations.filter((r) => r.id !== target.id)
  }
  let alreadyRemoved = false
  return relations.filter((r) => {
    if (alreadyRemoved || r.id !== undefined) return true
    const same =
      r.from === target.from &&
      r.to === target.to &&
      r.type === target.type &&
      r.label === target.label &&
      r.fromDoc === target.fromDoc &&
      r.toDoc === target.toDoc
    if (!same) return true
    alreadyRemoved = true
    return false
  })
}

/**
 * 關係的方向跟時間先後是否明顯矛盾（建立關係時提醒用，不擋）。
 *
 * 「A 導致 B」A 應該比 B 早；「A 回應 B」「A 衍生自 B」A 應該比 B 晚。
 * 只在「明顯」顛倒時回報：兩件事的時間範圍重疊（例如同一年、精度只到年）就不算，
 * 相對時間的事件沒有確切日期，也不判斷。矛盾、同一事件沒有先後可言。
 */
export function isRelationReversed(type: RelationType, from: HstEvent, to: HstEvent): boolean {
  if (!isAbsolute(from.start) || !isAbsolute(to.start)) return false
  const a = absolutePointRange(from.start)
  const b = absolutePointRange(to.start)
  if (type === 'causes') return a.start >= b.end
  if (type === 'responds_to' || type === 'derives_from') return a.end <= b.start
  return false
}
