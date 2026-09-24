// compose 層：時期（SPEC 7.5）的新增、改名、刪除（純函式）
//
// 圖層面板的時期編輯只做四件事：列出、新增（名稱＋起訖年）、改名、刪除。
// 顏色交給主題自動配，不做顏色挑選器（計畫書 2.4.3）。
// 這裡只負責把文件改成新的樣子；進不進復原歷史由 useLayers 的 mutate 決定。

import type { Period, TimelineDocument } from '../core'

/** 面板上「新增時期」表單填的東西 */
export interface PeriodDraft {
  title: string
  /** 四位數年份 */
  startYear: string
  /** 四位數年份；空白 = 至今 */
  endYear: string
}

const RE_YEAR = /^\d{4}$/

/** 表單哪裡填得不對（回傳給使用者看的中文）；都對就回傳 null */
export function periodDraftError(d: PeriodDraft): string | null {
  if (d.title.trim() === '') return '請填時期名稱'
  if (!RE_YEAR.test(d.startYear.trim())) return '起年請填四位數年份，例如 1949'
  const end = d.endYear.trim()
  if (end !== '' && !RE_YEAR.test(end)) return '迄年請填四位數年份，或留白表示「至今」'
  if (end !== '' && Number(end) < Number(d.startYear.trim())) return '迄年不能早於起年'
  return null
}

/** 時期檔案格式從 0.5 開始才有：文件版本比 0.5 舊就升上去，存出去的檔案才名副其實 */
export function withPeriodVersion(doc: TimelineDocument): TimelineDocument {
  const m = /^(\d+)\.(\d+)$/.exec(doc.hackstory ?? '')
  if (m && Number(m[1]) === 0 && Number(m[2]) < 5) return { ...doc, hackstory: '0.5' }
  return doc
}

/** 產生文件內唯一的時期 id */
function nextPeriodId(periods: Period[]): string {
  const used = new Set(periods.map((p) => p.id))
  let n = periods.length + 1
  while (used.has(`period-${n}`)) n++
  return `period-${n}`
}

/** 新增一個時期（依起始時間排好，面板與檔案裡的順序都跟時間一致） */
export function addPeriodToDoc(doc: TimelineDocument, draft: PeriodDraft): TimelineDocument {
  const existing = doc.periods ?? []
  const end = draft.endYear.trim()
  const period: Period = {
    id: nextPeriodId(existing),
    title: draft.title.trim(),
    start: { value: draft.startYear.trim(), precision: 'year' },
    ...(end ? { end: { value: end, precision: 'year' as const } } : {}),
  }
  const periods = [...existing, period].sort((a, b) =>
    a.start.value < b.start.value ? -1 : a.start.value > b.start.value ? 1 : 0,
  )
  return withPeriodVersion({ ...doc, periods })
}

/** 改名（依在清單中的位置指認：檔案裡的時期不一定有 id） */
export function renamePeriodInDoc(doc: TimelineDocument, index: number, title: string): TimelineDocument {
  const periods = doc.periods ?? []
  if (!periods[index] || title.trim() === '') return doc
  return { ...doc, periods: periods.map((p, i) => (i === index ? { ...p, title: title.trim() } : p)) }
}

/** 刪除；刪到一個也不剩就把欄位拿掉，檔案保持乾淨 */
export function removePeriodFromDoc(doc: TimelineDocument, index: number): TimelineDocument {
  const periods = doc.periods ?? []
  if (!periods[index]) return doc
  const rest = periods.filter((_, i) => i !== index)
  if (rest.length > 0) return { ...doc, periods: rest }
  const { periods: _drop, ...without } = doc
  void _drop
  return without
}

/** 面板上顯示的年份範圍，例如「1949–1987」「2000–至今」 */
export function periodYears(p: Period): string {
  const y = (v: string) => v.slice(0, 4)
  return `${y(p.start.value)}–${p.end ? y(p.end.value) : '至今'}`
}
