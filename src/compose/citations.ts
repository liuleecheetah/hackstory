// compose 層：輪播收尾頁的「資料來源」清單
//
// 從圖上畫出來的事件收集 sources，同一個出處只列一次（網址相同、或沒網址時名稱相同）。
// 依第一次出現的順序排（大致就是時間先後），讀者回查時比較好對。

import type { TimelineSource } from '../render/types'

export interface Citation {
  title: string
  url?: string
}

export function collectCitations(sources: TimelineSource[]): Citation[] {
  const seen = new Set<string>()
  const out: Citation[] = []
  for (const src of sources) {
    for (const ev of src.doc.events) {
      for (const ref of ev.sources ?? []) {
        const title = ref.title?.trim() ?? ''
        const url = ref.url?.trim() || undefined
        if (!title && !url) continue
        const key = url ? `url:${url}` : `title:${title}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push(url ? { title, url } : { title })
      }
    }
  }
  return out
}
