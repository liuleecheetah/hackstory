// adapters 層：.hst.json 匯入
// 把一段 JSON 文字讀成通過驗證的時間軸文件。只呼叫 core。

import type { TimelineDocument, ValidationIssue } from '../core'
import { validateDocument } from '../core'

export type ParseHstResult =
  | { ok: true; doc: TimelineDocument; warnings: ValidationIssue[] }
  | { ok: false; errors: ValidationIssue[]; warnings: ValidationIssue[] }

/** 讀入 .hst.json 的文字內容，回傳驗證過的文件或錯誤清單（給介面顯示） */
export function parseHstJson(text: string): ParseHstResult {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (e) {
    return {
      ok: false,
      // 不把瀏覽器的英文錯誤（Unexpected token…）丟給使用者：講清楚是什麼情況、該怎麼辦
      errors: [{ path: '', message: '檔案內容不是時間軸檔的格式，可能選錯檔案了（時間軸檔的檔名結尾是 .hst.json）' }],
      warnings: [],
    }
  }
  const result = validateDocument(data)
  if (!result.ok || !result.doc) {
    return { ok: false, errors: result.errors, warnings: result.warnings }
  }
  return { ok: true, doc: result.doc, warnings: result.warnings }
}
