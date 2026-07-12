// ui 層：事件詳情卡
// 點擊時間軸上的事件後浮出，完整顯示標題、日期、說明、地點、標籤、來源與查證程度。
// 位置跟著點擊處，但不會超出視窗。

import type { CSSProperties } from 'react'
import { isAbsolute } from '../core'
import type { EventSelection } from '../render/TimelineView'
import { formatPointLong } from '../render/timeScale'

interface Props {
  selection: EventSelection
  onClose: () => void
}

/** 查證程度的中文標籤與配色 */
const CONFIDENCE: Record<string, { label: string; cls: string }> = {
  verified: { label: '已查證', cls: 'bg-green-100 text-green-800' },
  reported: { label: '據報導', cls: 'bg-sky-100 text-sky-800' },
  disputed: { label: '有爭議', cls: 'bg-red-100 text-red-800' },
  unknown: { label: '未查證', cls: 'bg-slate-100 text-slate-600' },
}

const CARD_W = 340

export function EventDetailCard({ selection, onClose }: Props) {
  const { event, docTitle, trackTitle, color, clientX, clientY } = selection

  // 卡片位置：貼著點擊處，水平不出界；點在畫面下半部就往上開
  const style: CSSProperties = {
    width: CARD_W,
    left: Math.min(Math.max(8, clientX + 14), window.innerWidth - CARD_W - 8),
    maxHeight: '60vh',
  }
  if (clientY > window.innerHeight * 0.55) {
    style.bottom = window.innerHeight - clientY + 14
  } else {
    style.top = clientY + 14
  }

  // 日期文字：起（—迄），依精度誠實顯示
  const startText = isAbsolute(event.start) ? formatPointLong(event.start) : '（相對時間）'
  const endText = event.end && isAbsolute(event.end) ? formatPointLong(event.end) : null
  const confidence = event.confidence ? CONFIDENCE[event.confidence] : null

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
          {event.title}
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

        {event.location?.name && <p className="text-slate-500">地點：{event.location.name}</p>}

        {event.importance !== undefined && (
          <p className="text-xs text-amber-600" title={`重要性 ${event.importance}/5`}>
            重要性 {'★'.repeat(event.importance)}
            {'☆'.repeat(Math.max(0, 5 - event.importance))}
          </p>
        )}

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

      <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">
        {docTitle}
        {trackTitle !== docTitle && `｜${trackTitle}`}
      </p>
    </div>
  )
}
