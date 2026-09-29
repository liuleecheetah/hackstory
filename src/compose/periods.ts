// compose 層：時期（SPEC 7.5）的新增、改名、刪除（純函式）
//
// 圖層面板的時期編輯只做四件事：列出、新增（名稱＋起訖時間，可填到年、月或日）、改名、刪除。
// 顏色交給主題自動配，不做顏色挑選器（計畫書 2.4.3）。
// 這裡只負責把文件改成新的樣子；進不進復原歷史由 useLayers 的 mutate 決定。

import type { AbsoluteTimePoint, Period, TimelineDocument } from '../core'
import { absolutePointRange, parseDateTime } from '../core'

/** 面板上「新增時期」表單填的東西 */
export interface PeriodDraft {
  title: string
  /** 開始：年、年/月或年/月/日，例如 1949、1949/5、1949/5/20、1949年5月20日 */
  start: string
  /** 結束（同上）；空白 = 至今 */
  end: string
}

/**
 * 把表單上的一個時間讀成時間點。時期只要到「日」為止：寫了幾點幾分也不收，
 * 讀不懂就回傳錯誤原因
 */
function readPoint(raw: string): AbsoluteTimePoint | { error: string } {
  const r = parseDateTime(raw.trim())
  if (!r.ok) return { error: r.reason }
  if (!('value' in r.start) || r.start.precision === 'minute') {
    return { error: '時期只能填到年、月或日（不填時間）' }
  }
  return { value: r.start.value, precision: r.start.precision }
}

/** 表單哪裡填得不對（回傳給使用者看的中文）；都對就回傳 null */
export function periodDraftError(d: PeriodDraft): string | null {
  if (d.title.trim() === '') return '請填時期名稱'
  if (d.start.trim() === '') return '請填開始時間，例如 1949 或 1949/5/20'
  const start = readPoint(d.start)
  if ('error' in start) return `開始時間看不懂：${start.error}。可以填 1949、1949/5 或 1949/5/20`
  if (d.end.trim() === '') return null
  const end = readPoint(d.end)
  if ('error' in end) return `結束時間看不懂：${end.error}。可以填 1987、1987/7 或 1987/7/15，或留白表示「至今」`
  if (absolutePointRange(end).end <= absolutePointRange(start).start) return '結束時間不能早於開始時間'
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
  const start = readPoint(draft.start)
  // 表單已經用 periodDraftError 擋過；這裡再保險一次，讀不懂就不改文件
  if ('error' in start) return doc
  const end = draft.end.trim() === '' ? null : readPoint(draft.end)
  if (end && 'error' in end) return doc
  const period: Period = {
    id: nextPeriodId(existing),
    title: draft.title.trim(),
    start,
    ...(end ? { end } : {}),
  }
  const periods = [...existing, period].sort(
    (a, b) => absolutePointRange(a.start).start - absolutePointRange(b.start).start,
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

/** 面板上顯示的時間範圍，例如「1949–1987」「1949/5/20–1987/7/15」「2000–至今」 */
export function periodYears(p: Period): string {
  // 1949-05-20 → 1949/5/20（去掉月、日前面的 0）
  const show = (v: string) =>
    v
      .split('-')
      .map((part, i) => (i === 0 ? part : String(Number(part))))
      .join('/')
  return `${show(p.start.value)}–${p.end ? show(p.end.value) : '至今'}`
}
