// compose 層：主畫面的「找事件」——依人物、標籤或關鍵字找出符合的事件
//
// 找到的事件照常畫，其他事件由 render 淡化（不藏起來，前後脈絡還看得到）。
// 「哪些符合」是挑資料的工作，住在這裡；render 只拿到一組要強調的事件 key。

import type { HstEvent } from '../core'
import type { TimelineSource } from '../render/types'

/** 把搜尋字串拆成關鍵字：空白或全形空白分隔，忽略大小寫 */
function terms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[\s　]+/)
    .filter((t) => t !== '')
}

/** 事件裡拿來比對的文字：標題、說明、標籤、出處名稱 */
function haystack(ev: HstEvent): string {
  return [ev.title, ev.description ?? '', ...(ev.tags ?? []), ...(ev.sources ?? []).map((s) => s.title ?? '')]
    .join('\n')
    .toLowerCase()
}

/**
 * 找出符合搜尋字串的事件，回傳 `${圖層 id}/${事件 id}` 的集合。
 * 有好幾個關鍵字時要「全部都出現」才算（例如「蔣渭水 文化協會」）。
 * 搜尋字串是空的 → 回傳 null，代表沒有在搜尋。
 */
export function searchEvents(sources: TimelineSource[], query: string): Set<string> | null {
  const ts = terms(query)
  if (ts.length === 0) return null
  const hits = new Set<string>()
  for (const s of sources) {
    for (const ev of s.doc.events) {
      const text = haystack(ev)
      if (ts.every((t) => text.includes(t))) hits.add(`${s.id}/${ev.id}`)
    }
  }
  return hits
}
