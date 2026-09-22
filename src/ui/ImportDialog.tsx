// ui 層：匯入對話框
// 上傳 CSV 或貼 Google Sheet 公開網址 → 預覽「成功／警告／無法解析」→
// 逐筆修正壞資料 → 匯入為新圖層。
// 原則：匯入器永遠不靜默丟資料，所有問題都攤開給使用者處理。

import { useRef, useState } from 'react'
import type { HeaderMapping } from '../adapters/csv'
import { draftsToDocument, parseCsvText, retryRow } from '../adapters/csv'
import { fetchSheetCsv } from '../adapters/gsheet'
import type { DraftEvent, RawRow, RowWarning } from '../adapters/rows'
import type { TimelineDocument } from '../core'
import { validateDocument } from '../core'

interface Props {
  open: boolean
  onClose: () => void
  /** 匯入成功：把文件交給上層（App 會加成新圖層） */
  onImport: (doc: TimelineDocument) => void
}

/** 待修正列的可編輯狀態 */
interface EditableRow {
  key: number
  row: RawRow
  reason: string
}

interface PreviewState {
  headers: HeaderMapping[]
  drafts: DraftEvent[]
  warnings: RowWarning[]
  unresolved: EditableRow[]
  sourceType: 'csv' | 'google-sheet'
  sourceUrl?: string
}

const FIELD_LABELS: Record<string, string> = {
  start: '日期',
  time: '時間',
  end: '結束日期',
  title: '標題',
  description: '說明',
  location: '地點',
  track: '軸線',
  tags: '標籤',
  sources: '來源',
}

/** 事件草稿顯示用的日期文字（優先顯示原始輸入） */
const displayDate = (d: DraftEvent) =>
  (d.start.raw ?? d.start.value) + (d.end ? ` → ${d.end.raw ?? d.end.value}` : '')

export function ImportDialog({ open, onClose, onImport }: Props) {
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [title, setTitle] = useState('匯入的時間軸')
  const [inputError, setInputError] = useState<string | null>(null)
  const [sheetUrl, setSheetUrl] = useState('')
  const [loading, setLoading] = useState(false)
  // 逐筆修正後補發事件 id 用的流水號
  const nextIdRef = useRef(1)

  if (!open) return null

  const reset = () => {
    setPreview(null)
    setInputError(null)
    setSheetUrl('')
    setLoading(false)
  }

  const close = () => {
    reset()
    onClose()
  }

  /** 拿到 CSV 文字後進入預覽 */
  const showPreview = (
    text: string,
    sourceType: 'csv' | 'google-sheet',
    fallbackTitle?: string,
    sourceUrl?: string,
  ) => {
    const outcome = parseCsvText(text)
    if (!outcome.ok) {
      setInputError(outcome.error)
      return
    }
    nextIdRef.current = outcome.triage.events.length + 1
    // 圖層標題的優先順序：表格內的主題列 > 檔名／試算表名稱 > 通用名稱
    setTitle(
      outcome.titleHint ??
        fallbackTitle ??
        (sourceType === 'csv' ? '匯入的時間軸' : '從 Google Sheet 匯入'),
    )
    setInputError(null)
    setPreview({
      headers: outcome.headers,
      drafts: outcome.triage.events,
      warnings: outcome.triage.warnings,
      unresolved: outcome.triage.unresolved.map((u, i) => ({
        key: i,
        row: { ...u.row },
        reason: u.reason,
      })),
      sourceType,
      sourceUrl,
    })
  }

  const handleFile = (file: File) => {
    void file.text().then((text) => showPreview(text, 'csv', file.name.replace(/\.csv$/i, '')))
  }

  const handleSheet = async () => {
    setLoading(true)
    setInputError(null)
    const result = await fetchSheetCsv(sheetUrl)
    setLoading(false)
    if (!result.ok) {
      setInputError(result.error)
      return
    }
    // result.filename 是 Google 回傳的試算表名稱
    showPreview(result.text, 'google-sheet', result.filename, sheetUrl.trim())
  }

  /** 逐筆修正：重新解析使用者改過的列 */
  const handleRetry = (key: number) => {
    if (!preview) return
    const target = preview.unresolved.find((u) => u.key === key)
    if (!target) return
    const result = retryRow(target.row)
    if (result.ok) {
      const draft = {
        ...result.draft,
        id: `evt-${String(nextIdRef.current++).padStart(3, '0')}`,
      }
      setPreview({
        ...preview,
        drafts: [...preview.drafts, draft],
        unresolved: preview.unresolved.filter((u) => u.key !== key),
      })
    } else {
      setPreview({
        ...preview,
        unresolved: preview.unresolved.map((u) =>
          u.key === key ? { ...u, reason: result.reason } : u,
        ),
      })
    }
  }

  const handleImport = () => {
    if (!preview || preview.drafts.length === 0) return
    const doc = draftsToDocument(preview.drafts, {
      title: title.trim() || '匯入的時間軸',
      sourceType: preview.sourceType,
      sourceUrl: preview.sourceUrl,
    })
    const check = validateDocument(doc)
    if (!check.ok) {
      setInputError(`組成的文件沒通過驗證：${check.errors[0]?.message ?? '未知錯誤'}`)
      return
    }
    onImport(doc)
    close()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[88vh] w-[760px] max-w-full flex-col rounded-lg bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-base font-bold text-ink">
            {preview ? '匯入預覽' : '匯入 CSV / Google Sheet'}
          </h2>
          <button type="button" onClick={close} className="text-ink-faint hover:text-ink">
            ✕
          </button>
        </div>

        {!preview ? (
          /* ---- 第一步：選擇來源 ---- */
          <div className="flex flex-col gap-5 overflow-y-auto p-5">
            <section>
              <h3 className="mb-2 text-base font-semibold text-ink">上傳 CSV 檔案</h3>
              <label className="btn inline-block cursor-pointer bg-surface-alt">
                選擇檔案⋯
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) handleFile(f)
                    e.target.value = ''
                  }}
                />
              </label>
            </section>

            <section>
              <h3 className="mb-2 text-base font-semibold text-ink">
                或貼上 Google 試算表公開網址
              </h3>
              <p className="mb-2 text-sm text-ink-faint">
                試算表需「檔案 → 分享 → 發布到網路」或開啟「知道連結的人可檢視」。一次匯入一個分頁。
              </p>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={sheetUrl}
                  onChange={(e) => setSheetUrl(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  className="min-w-0 flex-1 rounded border border-line px-3 py-2 text-base"
                />
                <button
                  type="button"
                  onClick={() => void handleSheet()}
                  disabled={loading || sheetUrl.trim() === ''}
                  className="btn btn-primary disabled:opacity-40"
                >
                  {loading ? '讀取中⋯' : '讀取'}
                </button>
              </div>
            </section>

            {inputError && (
              <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-base text-red-700">
                {inputError}
              </p>
            )}

            <p className="border-t border-line pt-3 text-sm text-ink-faint">
              看不懂格式？
              <a
                href="https://github.com/liuleecheetah/hackstory/blob/main/docs/import-guide.md"
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-ink-muted"
              >
                閱讀匯入格式說明
              </a>
              ——欄位怎麼填、日期怎麼寫、Google Sheet 怎麼設成公開，都在裡面。
            </p>
          </div>
        ) : (
          /* ---- 第二步：預覽與逐筆修正 ---- */
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
              <span className="rounded bg-green-100 px-2 py-1 text-sm font-medium text-green-800">
                ✓ 成功 {preview.drafts.length} 筆
              </span>
              <span className="rounded bg-amber-100 px-2 py-1 text-sm font-medium text-amber-800">
                ⚠ 警告 {preview.warnings.length} 筆
              </span>
              <span className="rounded bg-red-100 px-2 py-1 text-sm font-medium text-red-800">
                ✕ 無法解析 {preview.unresolved.length} 筆
              </span>
              <span className="ml-auto text-sm text-ink-faint">
                認得的欄位：
                {preview.headers
                  .filter((h) => h.mapped)
                  .map((h) => h.original)
                  .join('、')}
              </span>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
              {/* 待修正（放最上面，這是需要使用者動手的地方） */}
              {preview.unresolved.length > 0 && (
                <section>
                  <h3 className="mb-2 text-base font-semibold text-red-700">
                    待修正（改好按「重試」，或按「忽略」放棄該列）
                  </h3>
                  <ul className="space-y-2">
                    {preview.unresolved.map((u) => (
                      <li key={u.key} className="rounded border border-red-200 bg-red-50 p-3">
                        <p className="mb-2 text-sm text-red-700">{u.reason}</p>
                        <div className="flex flex-wrap items-end gap-2">
                          {(['start', 'time', 'end', 'title'] as const).map((field) => (
                            <label key={field} className="text-sm text-ink-muted">
                              {FIELD_LABELS[field]}
                              <input
                                type="text"
                                value={u.row[field] ?? ''}
                                onChange={(e) =>
                                  setPreview((prev) =>
                                    prev
                                      ? {
                                          ...prev,
                                          unresolved: prev.unresolved.map((x) =>
                                            x.key === u.key
                                              ? { ...x, row: { ...x.row, [field]: e.target.value } }
                                              : x,
                                          ),
                                        }
                                      : prev,
                                  )
                                }
                                className="mt-0.5 block w-32 rounded border border-line bg-surface px-2 py-1 text-base"
                              />
                            </label>
                          ))}
                          <button
                            type="button"
                            onClick={() => handleRetry(u.key)}
                            className="btn btn-primary text-base"
                          >
                            重試
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setPreview((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      unresolved: prev.unresolved.filter((x) => x.key !== u.key),
                                    }
                                  : prev,
                              )
                            }
                            className="btn text-base"
                          >
                            忽略
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* 警告 */}
              {preview.warnings.length > 0 && (
                <section>
                  <h3 className="mb-2 text-base font-semibold text-amber-700">警告</h3>
                  <ul className="list-disc space-y-1 pl-5 text-sm text-amber-800">
                    {preview.warnings.map((w, i) => (
                      <li key={i}>{w.message}</li>
                    ))}
                  </ul>
                </section>
              )}

              {/* 成功清單 */}
              <section>
                <h3 className="mb-2 text-base font-semibold text-green-700">
                  將匯入的事件（疑似重複的列可按 ✕ 移除）
                </h3>
                <table className="w-full text-left text-base">
                  <thead>
                    <tr className="border-b border-line text-sm text-ink-faint">
                      <th className="py-1 pr-2 font-normal">日期</th>
                      <th className="py-1 pr-2 font-normal">標題</th>
                      <th className="w-8 py-1" />
                    </tr>
                  </thead>
                  <tbody>
                    {preview.drafts.map((d) => (
                      <tr
                        key={d.id}
                        className={
                          'border-b border-line ' +
                          (d.suspectedDuplicateOf ? 'bg-amber-50' : '')
                        }
                      >
                        <td className="whitespace-nowrap py-1 pr-2 text-ink-muted">
                          {displayDate(d)}
                        </td>
                        <td className="py-1 pr-2 text-ink">
                          {d.title}
                          {d.suspectedDuplicateOf && (
                            <span className="ml-2 rounded bg-amber-200 px-1.5 py-0.5 text-sm text-amber-900">
                              疑似重複
                            </span>
                          )}
                        </td>
                        <td className="py-1 text-right">
                          <button
                            type="button"
                            title="移除這一筆"
                            onClick={() =>
                              setPreview((prev) =>
                                prev
                                  ? { ...prev, drafts: prev.drafts.filter((x) => x.id !== d.id) }
                                  : prev,
                              )
                            }
                            className="text-ink-faint hover:text-red-600"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            </div>

            <div className="flex items-center gap-3 border-t border-line px-4 py-3">
              <label className="flex items-center gap-2 text-base text-ink-muted">
                圖層標題
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-56 rounded border border-line px-2 py-1 text-base"
                />
              </label>
              {inputError && <span className="text-sm text-red-600">{inputError}</span>}
              <div className="ml-auto flex gap-2">
                <button
                  type="button"
                  onClick={close}
                  className="btn"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleImport}
                  disabled={preview.drafts.length === 0}
                  className="btn btn-primary disabled:opacity-40"
                >
                  匯入 {preview.drafts.length} 筆為新圖層
                  {preview.unresolved.length > 0 && `（放棄未修正 ${preview.unresolved.length} 筆）`}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
