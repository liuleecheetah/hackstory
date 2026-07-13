// adapters 層：從公開網址載入時間軸（分享連結 ?src= 用）
// 不需要任何後端：檔案放在 GitHub / Gist 等任何允許跨網站讀取的地方，
// 或直接给公開的 Google 試算表網址（走 CSV 匯入流程）。

import type { TimelineDocument } from '../core'
import { draftsToDocument, parseCsvText } from './csv'
import { fetchSheetCsv, toCsvUrl } from './gsheet'
import { parseHstJson } from './json'

export type RemoteLoadResult =
  | { ok: true; doc: TimelineDocument; notice?: string }
  | { ok: false; error: string }

/** 從公開網址載入一份時間軸：.hst.json 或 Google 試算表 */
export async function loadFromUrl(url: string): Promise<RemoteLoadResult> {
  const trimmed = url.trim()
  if (!/^https?:\/\//.test(trimmed)) {
    return { ok: false, error: `「${trimmed.slice(0, 60)}」不是有效的網址` }
  }

  // Google 試算表 → CSV 匯入流程（分享連結打開時永遠是試算表的最新內容）
  if (toCsvUrl(trimmed)) {
    const sheet = await fetchSheetCsv(trimmed)
    if (!sheet.ok) return { ok: false, error: sheet.error }
    const outcome = parseCsvText(sheet.text)
    if (!outcome.ok) return { ok: false, error: outcome.error }
    if (outcome.triage.events.length === 0) {
      return { ok: false, error: '這份試算表沒有可顯示的事件' }
    }
    const title = outcome.titleHint ?? sheet.filename ?? '從 Google Sheet 匯入'
    const doc = draftsToDocument(outcome.triage.events, {
      title,
      sourceType: 'google-sheet',
      sourceUrl: trimmed,
    })
    const skipped = outcome.triage.unresolved.length
    return {
      ok: true,
      doc,
      // 分享檢視沒有匯入預覽可以逐筆修正，但問題也不靜默——告訴看的人少了幾筆
      notice: skipped > 0 ? `「${title}」有 ${skipped} 筆無法解析的資料未顯示` : undefined,
    }
  }

  // 一般網址：抓 .hst.json
  try {
    const res = await fetch(trimmed)
    if (!res.ok) {
      return { ok: false, error: `無法讀取分享的檔案（HTTP ${res.status}）：${trimmed.slice(0, 80)}` }
    }
    const parsed = parseHstJson(await res.text())
    if (!parsed.ok) {
      const first = parsed.errors[0]
      return {
        ok: false,
        error: `分享的檔案不是合法的時間軸：${first ? `${first.path} ${first.message}` : '格式錯誤'}`,
      }
    }
    return { ok: true, doc: parsed.doc }
  } catch {
    return {
      ok: false,
      error: `無法連線讀取 ${trimmed.slice(0, 80)}——對方網站可能不允許跨網站讀取（建議把檔案放在 GitHub 或 Gist）`,
    }
  }
}
