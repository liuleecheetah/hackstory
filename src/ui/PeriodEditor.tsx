// ui 層：圖層面板裡的「時期」小節
//
// 四件事：列出、新增、修改（名稱＋起訖時間，可填到年、月或日）、刪除（計畫書 2.4.3）。
// 新增與修改共用同一張小表單。顏色由主題自動配，不做顏色挑選器。修改都經過 useLayers，所以可以復原。

import { useState } from 'react'
import type { PeriodDraft } from '../compose/periods'
import { periodDraftError, periodToDraft, periodYears } from '../compose/periods'
import type { Period } from '../core'
import { selectAllOnMount } from './selectAll'

interface Props {
  periods: Period[]
  readOnly: boolean
  onAdd: (draft: PeriodDraft) => void
  /** 修改第 index 個時期的名稱與起訖時間 */
  onUpdate: (index: number, draft: PeriodDraft) => void
  onRemove: (index: number) => void
}

const EMPTY: PeriodDraft = { title: '', start: '', end: '' }

export function PeriodEditor({ periods, readOnly, onAdd, onUpdate, onRemove }: Props) {
  // 正在填的表單：新增（index = null）或修改第幾個；null = 收起來
  const [form, setForm] = useState<{ index: number | null; draft: PeriodDraft } | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 唯讀檢視又沒有時期：整個小節不出現
  if (readOnly && periods.length === 0) return null

  const close = () => {
    setForm(null)
    setError(null)
  }

  const submit = () => {
    if (!form) return
    const problem = periodDraftError(form.draft)
    if (problem) {
      setError(problem)
      return
    }
    if (form.index === null) onAdd(form.draft)
    else onUpdate(form.index, form.draft)
    close()
  }

  const field = (key: keyof PeriodDraft, placeholder: string, className: string, first = false) => (
    <input
      type="text"
      autoFocus={first}
      ref={first ? selectAllOnMount : undefined}
      value={form?.draft[key] ?? ''}
      placeholder={placeholder}
      onChange={(e) => setForm((f) => (f ? { ...f, draft: { ...f.draft, [key]: e.target.value } } : f))}
      onKeyDown={(e) => {
        if (e.key === 'Enter') submit()
        if (e.key === 'Escape') close()
      }}
      className={'min-w-0 rounded border border-line px-1 py-0.5 text-sm ' + className}
    />
  )

  const formBox = (isNew: boolean) => (
    <div className="mt-1 space-y-1 rounded border border-line bg-surface p-2">
      {field('title', '時期名稱，例如「戒嚴時期」', 'w-full', !isNew)}
      <div className="flex items-center gap-1 text-sm text-ink-muted">
        {field('start', '開始，例 1949/5/20', 'min-w-0 flex-1')}
        <span className="shrink-0">到</span>
        {field('end', '結束（留白＝至今）', 'min-w-0 flex-1')}
      </div>
      <p className="text-sm text-ink-faint">可以只填年（1949），或填到月（1949/5）、日（1949/5/20）</p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={submit} className="btn btn-primary">
          {isNew ? '新增' : '儲存'}
        </button>
        <button type="button" onClick={close} className="btn">
          取消
        </button>
      </div>
    </div>
  )

  return (
    <div className="mt-1 pl-6">
      {/* 沒有時期時只留「＋ 新增時期」一行，不多佔面板 */}
      {periods.length > 0 && <p className="py-0.5 text-sm text-ink-faint">時期（{periods.length}）</p>}
      <ul>
        {periods.map((p, i) =>
          form && form.index === i ? (
            <li key={p.id ?? i}>{formBox(false)}</li>
          ) : (
            <li key={p.id ?? i} className="flex items-center gap-2 py-0.5">
              {/* 名稱一行、起訖時間一行：填到月日後時間變長，擠在同一行名稱會被截成「戒嚴…」 */}
              <span className="min-w-0 flex-1" title={p.description ?? p.title}>
                <span className="block truncate text-sm text-ink-muted">{p.title}</span>
                <span className="block text-sm tabular-nums text-ink-faint">{periodYears(p)}</span>
              </span>
              {!readOnly && (
                <>
                  <button
                    type="button"
                    title="修改時期的名稱或起訖時間"
                    onClick={() => {
                      setForm({ index: i, draft: periodToDraft(p) })
                      setError(null)
                    }}
                    className="px-0.5 text-sm text-ink-faint hover:text-ink"
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    title="刪除這個時期（可以按復原找回）"
                    onClick={() => onRemove(i)}
                    className="px-0.5 text-sm text-ink-faint hover:text-red-600"
                  >
                    ✕
                  </button>
                </>
              )}
            </li>
          ),
        )}
      </ul>
      {!readOnly &&
        (form && form.index === null ? (
          formBox(true)
        ) : (
          <button
            type="button"
            onClick={() => {
              setForm({ index: null, draft: EMPTY })
              setError(null)
            }}
            className="py-0.5 text-sm text-ink-faint hover:text-ink"
          >
            ＋ 新增時期
          </button>
        ))}
    </div>
  )
}
