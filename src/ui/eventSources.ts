// ui 層：事件表單上的「資料來源」欄位整理
//
// 試用員（記者）回報：自己新增的事件沒辦法附出處，卻能標成「已查證」，同事和讀者無法回查。
// 表單上每一列是一筆來源（名稱＋網址），存檔時整理成 SPEC 的 sources。

import type { SourceRef } from '../core'

/** 表單上的一筆來源 */
export interface SourceRow {
  title: string
  url: string
}

/** 表單上的來源 → 存進事件的 sources：兩欄都空的列丟掉；網址不是 http(s) 開頭就回報錯誤 */
export function sourcesFromRows(rows: SourceRow[]): { sources: SourceRef[] } | { error: string } {
  const sources: SourceRef[] = []
  for (const row of rows) {
    const title = row.title.trim()
    const url = row.url.trim()
    if (!title && !url) continue
    if (url && !/^https?:\/\//i.test(url)) {
      return { error: `來源網址要以 http:// 或 https:// 開頭：「${url}」` }
    }
    sources.push({ ...(title ? { title } : {}), ...(url ? { url } : {}) })
  }
  return { sources }
}
