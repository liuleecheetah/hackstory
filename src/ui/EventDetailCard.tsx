// ui 層：事件詳情卡
// 點擊時間軸上的事件後浮出，完整顯示標題、日期、說明、地點、標籤、來源與查證程度。
// 按「編輯事件」切換成表單，可直接修改內容（日期欄吃匯入器支援的所有寫法）；
// 沒有提供 onUpdate 時（例如嵌入模式）為唯讀檢視。

import type { CSSProperties } from 'react'
import { useEffect, useState } from 'react'
import type { AbsoluteTimePoint, Confidence, HstEvent } from '../core'
import { isAbsolute, parseDateTime } from '../core'
import type { EventSelection } from '../render/TimelineView'
import { formatPointLong } from '../render/timeScale'

interface Props {
  selection: EventSelection
  onClose: () => void
  onToggleKey: () => void
  /** 儲存編輯後的事件。未提供時隱藏編輯功能（嵌入模式） */
  onUpdate?: (next: HstEvent) => void
  /** 刪除事件。未提供時隱藏刪除按鈕 */
  onDelete?: () => void
}

/** 查證程度的中文標籤與配色 */
const CONFIDENCE: Record<string, { label: string; cls: string }> = {
  verified: { label: '已查證', cls: 'bg-green-100 text-green-800' },
  reported: { label: '據報導', cls: 'bg-sky-100 text-sky-800' },
  disputed: { label: '有爭議', cls: 'bg-red-100 text-red-800' },
  unknown: { label: '未查證', cls: 'bg-slate-100 text-slate-600' },
}

/** 結束日期欄的「進行中」寫法（與匯入器一致） */
const RE_ONGOING = /^(至今|迄今|持續中|進行中|now|present|ongoing)$/i

const CARD_W = 340

interface FormState {
  title: string
  startRaw: string
  endRaw: string
  description: string
  location: string
  tags: string
  confidence: string
}

export function EventDetailCard({ selection, onClose, onToggleKey, onUpdate, onDelete }: Props) {
  const { event, docTitle, trackTitle, color, clientX, clientY } = selection

  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<FormState | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  // 換選不同事件時離開編輯模式
  useEffect(() => {
    setEditing(false)
    setFormError(null)
  }, [selection.key])

  // 卡片位置：貼著點擊處，水平不出界；點在畫面下半部就往上開
  const style: CSSProperties = {
    width: CARD_W,
    left: Math.min(Math.max(8, clientX + 14), window.innerWidth - CARD_W - 8),
    maxHeight: '64vh',
  }
  if (clientY > window.innerHeight * 0.55) {
    style.bottom = window.innerHeight - clientY + 14
  } else {
    style.top = clientY + 14
  }

  // 日期文字：起（—迄），依精度誠實顯示；進行中事件顯示「至今仍持續」；
  // 相對時間事件顯示先後關係並註明畫面位置只是推估
  const startText = isAbsolute(event.start)
    ? formatPointLong(event.start)
    : `${selection.relativeNote || '相對時間'}（畫面位置為推估）`
  const endText =
    event.end && isAbsolute(event.end)
      ? formatPointLong(event.end)
      : event.ongoing
        ? '至今仍持續'
        : null
  const confidence = event.confidence ? CONFIDENCE[event.confidence] : null
  const isKey = (event.importance ?? 0) >= 5

  const startEdit = () => {
    setForm({
      title: event.title,
      startRaw: isAbsolute(event.start) ? (event.start.raw ?? event.start.value) : '',
      endRaw:
        event.end && isAbsolute(event.end)
          ? (event.end.raw ?? event.end.value)
          : event.ongoing
            ? '至今'
            : '',
      description: event.description ?? '',
      location: event.location?.name ?? '',
      tags: (event.tags ?? []).join(', '),
      confidence: event.confidence ?? '',
    })
    setFormError(null)
    setEditing(true)
  }

  const save = () => {
    if (!form || !onUpdate) return
    const title = form.title.trim()
    if (title === '') {
      setFormError('標題不能空白')
      return
    }

    // 開始日期：留空時，相對時間事件保持原本的先後設定；絕對時間事件必填
    let start = event.start
    let derivedEnd: AbsoluteTimePoint | undefined
    const startRaw = form.startRaw.trim()
    if (startRaw === '') {
      if (isAbsolute(event.start)) {
        setFormError('開始日期不能空白（只有相對時間事件可以留空）')
        return
      }
    } else {
      const parsed = parseDateTime(startRaw)
      if (!parsed.ok) {
        setFormError(`開始日期：${parsed.reason}`)
        return
      }
      start = parsed.start
      derivedEnd = parsed.end // 例如「2016/11/24 09:00-18:00」一格寫完起訖
    }

    // 結束日期：空白＝無、「至今」＝進行中、其他照日期解析
    let end: AbsoluteTimePoint | undefined
    let ongoing = false
    const endRaw = form.endRaw.trim()
    if (RE_ONGOING.test(endRaw)) {
      ongoing = true
    } else if (endRaw !== '') {
      const parsedEnd = parseDateTime(endRaw)
      if (!parsedEnd.ok) {
        setFormError(`結束日期：${parsedEnd.reason}`)
        return
      }
      end = parsedEnd.start
    } else if (derivedEnd) {
      end = derivedEnd
    }

    const next: HstEvent = { ...event, title, start }
    if (end) next.end = end
    else delete next.end
    if (ongoing) next.ongoing = true
    else delete next.ongoing

    const description = form.description.trim()
    if (description) next.description = description
    else delete next.description

    const locationName = form.location.trim()
    if (locationName) next.location = { ...(event.location ?? {}), name: locationName }
    else delete next.location

    const tags = form.tags.split(/[,、]/).map((t) => t.trim()).filter((t) => t !== '')
    if (tags.length > 0) next.tags = tags
    else delete next.tags

    if (form.confidence) next.confidence = form.confidence as Confidence
    else delete next.confidence

    onUpdate(next)
    setEditing(false)
    setFormError(null)
  }

  const setField = (field: keyof FormState, value: string) =>
    setForm((prev) => (prev ? { ...prev, [field]: value } : prev))

  const inputCls = 'w-full rounded border border-slate-300 px-2 py-1 text-sm'
  const labelCls = 'block text-xs text-slate-500'

  return (
    <div
      className="fixed z-40 flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl"
      style={style}
    >
      <div className="flex items-start gap-2 px-4 pt-3">
        <span
          className="mt-1.5 h-3 w-3 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
        <h3 className="min-w-0 flex-1 text-sm font-bold leading-snug text-slate-800">
          {editing ? '編輯事件' : event.title}
        </h3>
        <button
          type="button"
          onClick={onClose}
          title="關閉"
          className="-mr-1 px-1 text-slate-400 hover:text-slate-700"
        >
          ✕
        </button>
      </div>

      {editing && form ? (
        /* ---- 編輯模式 ---- */
        <div className="min-h-0 space-y-2 overflow-y-auto px-4 py-3">
          <label className={labelCls}>
            標題
            <input
              type="text"
              value={form.title}
              onChange={(e) => setField('title', e.target.value)}
              className={inputCls}
            />
          </label>
          <div className="flex gap-2">
            <label className={`${labelCls} flex-1`}>
              開始日期
              <input
                type="text"
                value={form.startRaw}
                onChange={(e) => setField('startRaw', e.target.value)}
                placeholder={isAbsolute(event.start) ? '例：2017/5/24' : '留空＝保持相對時間'}
                className={inputCls}
              />
            </label>
            <label className={`${labelCls} flex-1`}>
              結束日期
              <input
                type="text"
                value={form.endRaw}
                onChange={(e) => setField('endRaw', e.target.value)}
                placeholder="空白＝無；至今＝進行中"
                className={inputCls}
              />
            </label>
          </div>
          <label className={labelCls}>
            說明
            <textarea
              value={form.description}
              onChange={(e) => setField('description', e.target.value)}
              rows={4}
              className={inputCls}
            />
          </label>
          <div className="flex gap-2">
            <label className={`${labelCls} flex-1`}>
              地點
              <input
                type="text"
                value={form.location}
                onChange={(e) => setField('location', e.target.value)}
                className={inputCls}
              />
            </label>
            <label className={`${labelCls} flex-1`}>
              查證程度
              <select
                value={form.confidence}
                onChange={(e) => setField('confidence', e.target.value)}
                className={inputCls}
              >
                <option value="">未設定</option>
                <option value="verified">已查證</option>
                <option value="reported">據報導</option>
                <option value="disputed">有爭議</option>
                <option value="unknown">未查證</option>
              </select>
            </label>
          </div>
          <label className={labelCls}>
            標籤（逗號分隔）
            <input
              type="text"
              value={form.tags}
              onChange={(e) => setField('tags', e.target.value)}
              className={inputCls}
            />
          </label>

          {formError && <p className="text-xs text-red-600">{formError}</p>}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={save}
              className="rounded bg-slate-800 px-4 py-1.5 text-sm text-white hover:bg-slate-700"
            >
              儲存
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false)
                setFormError(null)
              }}
              className="rounded border border-slate-300 px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
            >
              取消
            </button>
          </div>
          <p className="text-xs text-slate-400">
            改動保留在這個圖層裡，記得用「匯出／分享」下載保存。
          </p>
        </div>
      ) : (
        /* ---- 檢視模式 ---- */
        <>
          <div className="min-h-0 space-y-2 overflow-y-auto px-4 py-3 text-sm">
            <p className="text-slate-600">
              {startText}
              {endText && ` — ${endText}`}
              {confidence && (
                <span className={`ml-2 rounded px-1.5 py-0.5 text-xs ${confidence.cls}`}>
                  {confidence.label}
                </span>
              )}
            </p>

            {event.description && (
              <p className="whitespace-pre-wrap leading-relaxed text-slate-700">
                {event.description}
              </p>
            )}

            {event.location?.name && (
              <p className="text-slate-500">地點：{event.location.name}</p>
            )}

            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={isKey}
                onChange={onToggleKey}
                className="accent-amber-500"
              />
              標示為關鍵事件（在時間軸上放大顯示）
            </label>

            {event.tags && event.tags.length > 0 && (
              <p className="flex flex-wrap gap-1">
                {event.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600"
                  >
                    {tag}
                  </span>
                ))}
              </p>
            )}

            {event.sources && event.sources.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold text-slate-500">資料來源</p>
                <ul className="space-y-0.5">
                  {event.sources.map((s, i) => (
                    <li key={i} className="truncate text-xs">
                      {s.url ? (
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sky-700 underline hover:text-sky-900"
                        >
                          {s.title ?? s.url}
                        </a>
                      ) : (
                        <span className="text-slate-600">{s.title}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {onUpdate && (
            <div className="flex items-center gap-2 border-t border-slate-100 px-4 py-2">
              <button
                type="button"
                onClick={startEdit}
                className="rounded border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-100"
              >
                ✎ 編輯事件
              </button>
              {onDelete && (
                <button
                  type="button"
                  onClick={() => {
                    if (
                      window.confirm(
                        `確定要刪除「${event.title}」嗎？指向它的關係線也會一併移除。`,
                      )
                    ) {
                      onDelete()
                    }
                  }}
                  className="ml-auto px-2 text-xs text-red-500 hover:text-red-700"
                >
                  刪除
                </button>
              )}
            </div>
          )}
        </>
      )}

      <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">
        {docTitle}
        {trackTitle !== docTitle && `｜${trackTitle}`}
      </p>
    </div>
  )
}
