// adapters 層：CSV 匯入
// 用 papaparse 把 CSV 文字讀成列，欄位對應與髒資料分流全部交給 core（rows.ts）。
// 這一層不碰畫面，也不知道 CSV 是使用者上傳的還是從 Google Sheet 抓來的。

import Papa from 'papaparse'
import type {
  DraftEvent,
  HstEvent,
  RawRow,
  StandardField,
  TimelineDocument,
  TriageResult,
} from '../core'
import { mapHeader, triageRows } from '../core'

/** 表頭對應結果：原始表頭 → 認出的標準欄位（null = 認不得，該欄忽略） */
export interface HeaderMapping {
  original: string
  mapped: StandardField | null
}

export type CsvParseOutcome =
  | {
      ok: true
      headers: HeaderMapping[]
      triage: TriageResult
    }
  | { ok: false; error: string }

/** 把 CSV 文字解析並分流。回傳成功事件／警告／待修正三堆（絕不靜默丟資料） */
export function parseCsvText(text: string): CsvParseOutcome {
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ''), {
    skipEmptyLines: false,
  })
  const rows = parsed.data.filter((r) => Array.isArray(r))
  // 找到第一個有內容的列當表頭
  const headerIndex = rows.findIndex((r) => r.some((cell) => cell && cell.trim() !== ''))
  if (headerIndex < 0) {
    return { ok: false, error: '檔案是空的，找不到任何內容' }
  }

  const headers: HeaderMapping[] = rows[headerIndex].map((h) => ({
    original: h.trim(),
    mapped: mapHeader(h),
  }))

  const hasStart = headers.some((h) => h.mapped === 'start')
  const hasTitle = headers.some((h) => h.mapped === 'title')
  if (!hasStart || !hasTitle) {
    const found = headers.map((h) => h.original).filter((h) => h !== '').join('、') || '（無）'
    return {
      ok: false,
      error:
        `認不出必要的欄位：${!hasStart ? '「日期」' : ''}${!hasStart && !hasTitle ? '與' : ''}${!hasTitle ? '「標題」' : ''}。` +
        `檔案裡的表頭是：${found}。支援的表頭例如「日期／Start Date」「標題／Title／事件」`,
    }
  }

  // 資料列 → RawRow（標準欄位 → 字串值）
  const rawRows: RawRow[] = rows.slice(headerIndex + 1).map((cells) => {
    const row: RawRow = {}
    headers.forEach((h, i) => {
      const value = cells[i]
      // 同名欄位以先出現者為準，不覆寫
      if (h.mapped && value !== undefined && row[h.mapped] === undefined) {
        row[h.mapped] = value
      }
    })
    return row
  })

  return { ok: true, headers, triage: triageRows(rawRows) }
}

/**
 * 逐筆修正用：使用者改完一列的欄位後重新解析。
 * 成功回傳事件草稿（id 是暫代的，由呼叫端重新編號），失敗回傳中文原因。
 */
export function retryRow(row: RawRow): { ok: true; draft: DraftEvent } | { ok: false; reason: string } {
  const triage = triageRows([row])
  if (triage.events.length === 1) {
    return { ok: true, draft: triage.events[0] }
  }
  if (triage.unresolved.length === 1) {
    return { ok: false, reason: triage.unresolved[0].reason }
  }
  if (triage.warnings.length > 0) {
    return { ok: false, reason: triage.warnings[0].message }
  }
  return { ok: false, reason: '這一列是空的' }
}

/** 匯入選項 */
export interface BuildDocumentOptions {
  title: string
  sourceType: 'csv' | 'google-sheet'
  sourceUrl?: string
}

/**
 * 把分流後（且經使用者修正、確認）的事件草稿組成一份合法的時間軸文件。
 * 有「軸線／分類」欄的列依值分軌；沒有的歸入「匯入資料」軸。
 */
export function draftsToDocument(
  drafts: DraftEvent[],
  options: BuildDocumentOptions,
): TimelineDocument {
  // 依出現順序收集軸線名稱
  const trackTitles: string[] = []
  for (const d of drafts) {
    const t = d.track?.trim() || '匯入資料'
    if (!trackTitles.includes(t)) trackTitles.push(t)
  }
  const trackIdOf = (title: string) => `track-${trackTitles.indexOf(title) + 1}`

  const events: HstEvent[] = drafts.map((d) => {
    const ev: HstEvent = {
      id: d.id,
      track: trackIdOf(d.track?.trim() || '匯入資料'),
      title: d.title,
      start: d.start,
    }
    if (d.end) ev.end = d.end
    if (d.description) ev.description = d.description
    if (d.location) ev.location = d.location
    if (d.tags) ev.tags = d.tags
    if (d.sources) ev.sources = d.sources
    return ev
  })

  const today = new Date().toISOString().slice(0, 10)
  return {
    hackstory: '0.1',
    id: `imported-${Date.now()}`,
    meta: {
      title: options.title,
      license: 'CC-BY-4.0',
      language: 'zh-TW',
      created: today,
      updated: today,
      revision: 1,
      source: {
        type: options.sourceType,
        ...(options.sourceUrl ? { url: options.sourceUrl } : {}),
      },
    },
    tracks: trackTitles.map((title, i) => ({ id: `track-${i + 1}`, title, order: i + 1 })),
    events,
  }
}
