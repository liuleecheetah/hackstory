// ui 層：建立關係的小表單
// 連結模式下點選目標事件後浮出：選關係類型、填選填的說明文字，按「建立」。

import type { CSSProperties } from 'react'
import { useState } from 'react'
import type { RelationType } from '../core'

interface Props {
  fromTitle: string
  toTitle: string
  clientX: number
  clientY: number
  onCreate: (type: RelationType, label: string) => void
  onCancel: () => void
}

/** 關係類型的中文名稱（SPEC 第 7 節） */
const TYPE_OPTIONS: Array<{ value: RelationType; label: string }> = [
  { value: 'causes', label: '導致' },
  { value: 'responds_to', label: '回應／反制' },
  { value: 'derives_from', label: '衍生自' },
  { value: 'contradicts', label: '與之矛盾' },
  { value: 'same_event', label: '同一事件的不同記載' },
]

const W = 320

export function RelationDialog({ fromTitle, toTitle, clientX, clientY, onCreate, onCancel }: Props) {
  const [type, setType] = useState<RelationType>('causes')
  const [label, setLabel] = useState('')

  const style: CSSProperties = {
    width: W,
    left: Math.min(Math.max(8, clientX + 14), window.innerWidth - W - 8),
  }
  if (clientY > window.innerHeight * 0.55) {
    style.bottom = window.innerHeight - clientY + 14
  } else {
    style.top = clientY + 14
  }

  const typeLabel = TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type

  return (
    <div
      className="fixed z-40 flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-4 shadow-xl"
      style={style}
    >
      <h3 className="text-sm font-bold text-slate-800">建立關係</h3>
      {/* 讀起來像一句話：起點 →（類型）→ 目標 */}
      <p className="text-xs leading-relaxed text-slate-600">
        「<span className="font-medium">{fromTitle}</span>」
        <span className="mx-1 rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">{typeLabel}</span>
        「<span className="font-medium">{toTitle}</span>」
      </p>

      <label className="block text-xs text-slate-500">
        關係類型
        <select
          value={type}
          onChange={(e) => setType(e.target.value as RelationType)}
          className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-sm"
        >
          {TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-xs text-slate-500">
        線上顯示的說明（選填）
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="例：104 年後成真"
          className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-sm"
        />
      </label>

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={() => onCreate(type, label)}
          className="rounded bg-slate-800 px-4 py-1.5 text-sm text-white hover:bg-slate-700"
        >
          建立
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-slate-300 px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
        >
          取消
        </button>
      </div>
    </div>
  )
}
