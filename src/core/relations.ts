// core 層：關係的語意判斷輔助
// 「這條關係是不是跨文件的」只在這裡定義一次，其他層一律呼叫這個函式。
// 事件 id 只保證在「同一份文件內」唯一，所以光看 from／to 的字串無法分辨
// 它指的是本文件的事件、還是別份文件裡剛好同名的事件——必須看 fromDoc／toDoc。

import type { Relation } from './types'

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
