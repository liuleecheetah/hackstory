// ui 層：圖層面板裡的「時期」小節
//
// 只做四件事：列出、新增（名稱＋起年＋迄年）、改名、刪除（計畫書 2.4.3）。
// 顏色由主題自動配，不做顏色挑選器。修改都經過 useLayers，所以可以復原。

import { useState } from 'react'
import type { PeriodDraft } from '../compose/periods'
import { periodDraftError, periodYears } from '../compose/periods'
import type { Period } from '../core'

interface Props {
  periods: Period[]
  readOnly: boolean
  onAdd: (draft: PeriodDraft) => void
  onRename: (index: number, title: string) => void
  onRemove: (index: number) => void
}

const EMPTY: PeriodDraft = { title: '', startYear: '', endYear: '' }

export function PeriodEditor({ periods, readOnly, onAdd, onRename, onRemove }: Props) {
  // 正在改名的時期（清單位置）與草稿
  const [editing, setEditing] = useState<number | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  // 新增表單：null = 收起來
  const [adding, setAdding] = useState<PeriodDraft | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 唯讀檢視又沒有時期：整個小節不出現
  if (readOnly && periods.length === 0) return null

  const commitRename = (index: number) => {
    if (draftTitle.trim() !== '') onRename(index, draftTitle.trim())
    setEditing(null)
  }

  const submit = () => {
    if (!adding) return
    const problem = periodDraftError(adding)
    if (problem) {
      setError(problem)
      return
    }
    onAdd(adding)
    setAdding(null)
    setError(null)
  }

  const field = (key: keyof PeriodDraft, placeholder: string, className: string) => (
    <input
      type="text"
      inputMode={key === 'title' ? undefined : 'numeric'}
      value={adding?.[key] ?? ''}
      placeholder={placeholder}
      onChange={(e) => setAdding((d) => (d ? { ...d, [key]: e.target.value } : d))}
      onKeyDown={(e) => {
        if (e.key === 'Enter') submit()
        if (e.key === 'Escape') setAdding(null)
      }}
      className={'min-w-0 rounded border border-line px-1 py-0.5 text-sm ' + className}
    />
  )

  return (
    <div className="mt-1 pl-6">
      {/* 沒有時期時只留「＋ 新增時期」一行，不多佔面板 */}
      {periods.length > 0 && <p className="py-0.5 text-sm text-ink-faint">時期（{periods.length}）</p>}
      <ul>
        {periods.map((p, i) => (
          <li key={p.id ?? i} className="flex items-center gap-2 py-0.5">
            {editing === i ? (
              <input
                autoFocus
                type="text"
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                onBlur={() => commitRename(i)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename(i)
                  if (e.key === 'Escape') setEditing(null)
                }}
                className="min-w-0 flex-1 rounded border border-line px-1 py-0.5 text-sm"
              />
            ) : (
              <span className="min-w-0 flex-1 truncate text-sm text-ink-muted" title={p.description ?? p.title}>
                {p.title}
              </span>
            )}
            <span className="shrink-0 text-sm tabular-nums text-ink-faint">{periodYears(p)}</span>
            {!readOnly && (
              <>
                <button
                  type="button"
                  title="重新命名時期"
                  onClick={() => {
                    setEditing(i)
                    setDraftTitle(p.title)
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
        ))}
      </ul>
      {!readOnly &&
        (adding ? (
          <div className="mt-1 space-y-1 rounded border border-line bg-surface p-2">
            {field('title', '時期名稱，例如「戒嚴時期」', 'w-full')}
            <div className="flex items-center gap-1 text-sm text-ink-muted">
              {field('startYear', '起年', 'w-16')}
              <span>到</span>
              {field('endYear', '迄年（留白＝至今）', 'w-32')}
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={submit} className="btn btn-primary">
                新增
              </button>
              <button
                type="button"
                onClick={() => {
                  setAdding(null)
                  setError(null)
                }}
                className="btn"
              >
                取消
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setAdding(EMPTY)
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
