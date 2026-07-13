// core 層：時間解析器
// 把真實世界的髒日期字串（2017/5/24、2010年6月、09:00-18:00⋯⋯）
// 解析成帶精度的 AbsoluteTimePoint。
// 原則：解析失敗絕不丟例外、絕不靜默丟資料，一律回傳失敗原因讓上層呈現給使用者。

import type { AbsoluteTimePoint, Precision } from './types'

/** 解析成功：至少有 start，若輸入含時間區段（09:00-18:00）則有 end */
export interface ParsedDateTime {
  ok: true
  start: AbsoluteTimePoint
  end?: AbsoluteTimePoint
  /** 非致命問題（例如：日期只精確到月，附帶的時間被忽略） */
  warnings: string[]
}

/** 解析失敗：保留原始字串與中文原因 */
export interface ParseFailure {
  ok: false
  raw: string
  reason: string
}

export type DateTimeParseResult = ParsedDateTime | ParseFailure

const pad2 = (n: number) => String(n).padStart(2, '0')

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function daysInMonth(year: number, month: number): number {
  const table = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return table[month - 1]
}

/**
 * 檢查一個已符合格式的 value 是否為真實存在的日期時間
 * （例如 2017-02-30 格式正確但日期不存在）。
 * 回傳 null 表示合法，否則回傳中文錯誤訊息。
 */
export function checkCalendarValue(value: string, precision: Precision): string | null {
  const m = value.match(/^(\d{4})(?:-(\d{2})(?:-(\d{2})(?:T(\d{2}):(\d{2}))?)?)?$/)
  if (!m) return `值「${value}」不符合 ${precision} 精度的格式`
  const year = Number(m[1])
  if (precision === 'year') return null
  const month = Number(m[2])
  if (m[2] === undefined || month < 1 || month > 12) return `月份「${m[2] ?? ''}」超出 1–12 的範圍`
  if (precision === 'month') return null
  const day = Number(m[3])
  if (m[3] === undefined || day < 1 || day > daysInMonth(year, month)) {
    return `${year} 年 ${month} 月沒有第 ${m[3] ?? '?'} 天`
  }
  if (precision === 'day') return null
  const hh = Number(m[4])
  const mm = Number(m[5])
  if (m[4] === undefined || hh > 23) return `小時「${m[4] ?? ''}」超出 0–23 的範圍`
  if (m[5] === undefined || mm > 59) return `分鐘「${m[5] ?? ''}」超出 0–59 的範圍`
  return null
}

/**
 * 把絕對時間點展開成毫秒範圍。月／年精度誠實涵蓋整段期間，
 * 不假裝知道確切日期。render 層與相對時間求解器共用。
 */
export function absolutePointRange(point: AbsoluteTimePoint): { start: number; end: number } {
  const v = point.value
  switch (point.precision) {
    case 'year': {
      const y = Number(v)
      return { start: new Date(y, 0, 1).getTime(), end: new Date(y + 1, 0, 1).getTime() }
    }
    case 'month': {
      const [y, m] = v.split('-').map(Number)
      return { start: new Date(y, m - 1, 1).getTime(), end: new Date(y, m, 1).getTime() }
    }
    case 'day': {
      const [y, m, d] = v.split('-').map(Number)
      return { start: new Date(y, m - 1, d).getTime(), end: new Date(y, m - 1, d + 1).getTime() }
    }
    case 'minute': {
      const [datePart, timePart] = v.split('T')
      const [y, m, d] = datePart.split('-').map(Number)
      const [hh, mm] = timePart.split(':').map(Number)
      const start = new Date(y, m - 1, d, hh, mm).getTime()
      return { start, end: start + 60_000 }
    }
  }
}

// ---- 日期部分 ----------------------------------------------------------

// 接受的分隔符號：/ - . 與中文的 年 月 日
const RE_YEAR = /^(\d{4})\s*年?$/
const RE_MONTH = /^(\d{4})\s*[/\-.年]\s*(\d{1,2})\s*月?$/
const RE_DAY = /^(\d{4})\s*[/\-.年]\s*(\d{1,2})\s*[/\-.月]\s*(\d{1,2})\s*日?$/
const RE_ISO_MINUTE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/

interface DateParts {
  value: string
  precision: Precision
}

/** 只解析「日期」部分（不含時間欄位），失敗回傳 null */
function parseDateParts(raw: string): DateParts | { error: string } | null {
  const s = raw.trim()
  if (s === '') return null

  let m = s.match(RE_ISO_MINUTE)
  if (m) {
    return { value: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`, precision: 'minute' }
  }

  m = s.match(RE_DAY)
  if (m) {
    const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])]
    if (month < 1 || month > 12) return { error: `月份「${m[2]}」超出 1–12 的範圍` }
    if (day < 1 || day > daysInMonth(year, month)) {
      return { error: `${year} 年 ${month} 月沒有第 ${m[3]} 天` }
    }
    return { value: `${year}-${pad2(month)}-${pad2(day)}`, precision: 'day' }
  }

  m = s.match(RE_MONTH)
  if (m) {
    const [year, month] = [Number(m[1]), Number(m[2])]
    if (month < 1 || month > 12) return { error: `月份「${m[2]}」超出 1–12 的範圍` }
    return { value: `${year}-${pad2(month)}`, precision: 'month' }
  }

  m = s.match(RE_YEAR)
  if (m) {
    return { value: m[1], precision: 'year' }
  }

  return null
}

// ---- 時間（時刻）部分 --------------------------------------------------

const RE_TIME = /^(\d{1,2}):(\d{2})$/
// 區段分隔接受 - – — ~ 至
const RE_TIME_RANGE = /^(\d{1,2}):(\d{2})\s*[-–—~至]\s*(\d{1,2}):(\d{2})$/

interface TimeOfDay {
  hh: number
  mm: number
}

function checkTimeOfDay(hh: number, mm: number): string | null {
  if (hh > 23) return `小時「${hh}」超出 0–23 的範圍`
  if (mm > 59) return `分鐘「${mm}」超出 0–59 的範圍`
  return null
}

/** 解析時刻字串："09:00" 或 "09:00-18:00"。失敗回傳中文原因 */
function parseTimeOfDayParts(
  raw: string,
): { start: TimeOfDay; end?: TimeOfDay } | { error: string } | null {
  const s = raw.trim()
  if (s === '') return null

  let m = s.match(RE_TIME_RANGE)
  if (m) {
    const start = { hh: Number(m[1]), mm: Number(m[2]) }
    const end = { hh: Number(m[3]), mm: Number(m[4]) }
    const bad = checkTimeOfDay(start.hh, start.mm) ?? checkTimeOfDay(end.hh, end.mm)
    if (bad) return { error: bad }
    return { start, end }
  }

  m = s.match(RE_TIME)
  if (m) {
    const start = { hh: Number(m[1]), mm: Number(m[2]) }
    const bad = checkTimeOfDay(start.hh, start.mm)
    if (bad) return { error: bad }
    return { start }
  }

  return { error: `無法解析時間「${raw}」` }
}

// ---- 主要入口 ----------------------------------------------------------

/**
 * 解析「日期字串」＋選填的「時刻字串」，對應試算表的日期欄與時間欄。
 *
 * 支援格式（SPEC 第 9 節的真實髒資料）：
 * - "2017/5/24"、"2017/02/20"、"2017-3-24"、"2017.5.24"、"2010年6月3日" → day
 * - "2010年6月"、"2010/6"、"2010-06" → month
 * - "1986"、"1986年" → year
 * - 日期 + "09:00"        → minute（單一時間點）
 * - 日期 + "09:00-18:00"  → start 09:00、end 18:00（同日）
 * - "2016/12/10 13:00" 這種日期時間寫在同一格的也接受
 *
 * 完全無法解析時回傳 { ok: false, raw, reason }——絕不靜默丟棄，
 * 上層要把它收進「待修正」清單顯示給使用者。
 */
export function parseDateTime(dateRaw: string, timeRaw?: string): DateTimeParseResult {
  const originalRaw = timeRaw?.trim() ? `${dateRaw.trim()} ${timeRaw.trim()}` : dateRaw.trim()

  let datePart = dateRaw.trim()
  let timePart = timeRaw?.trim() ?? ''

  // 日期與時間寫在同一格（例如 "2016/11/24 09:00-18:00"）：從空白處拆開
  if (timePart === '' && /\s/.test(datePart)) {
    const idx = datePart.search(/\s/)
    const head = datePart.slice(0, idx)
    const tail = datePart.slice(idx).trim()
    if (/^\d{1,2}:\d{2}/.test(tail)) {
      datePart = head
      timePart = tail
    }
  }

  if (datePart === '') {
    return { ok: false, raw: originalRaw, reason: '日期是空的' }
  }

  const date = parseDateParts(datePart)
  if (date === null) {
    return { ok: false, raw: originalRaw, reason: `無法解析日期「${datePart}」` }
  }
  if ('error' in date) {
    return { ok: false, raw: originalRaw, reason: date.error }
  }

  const warnings: string[] = []

  // 沒有時間欄位：直接回傳日期精度的時間點
  if (timePart === '') {
    return {
      ok: true,
      start: { value: date.value, precision: date.precision, raw: originalRaw },
      warnings,
    }
  }

  // 有時間欄位，但日期不到「日」的精度（例如只知道 2010年6月）：時間無法掛上去
  if (date.precision !== 'day') {
    if (date.precision === 'minute') {
      warnings.push(`日期本身已含時間，額外的時間欄「${timePart}」已忽略`)
    } else {
      warnings.push(`日期只精確到「${date.precision === 'year' ? '年' : '月'}」，時間欄「${timePart}」已忽略`)
    }
    return {
      ok: true,
      start: { value: date.value, precision: date.precision, raw: originalRaw },
      warnings,
    }
  }

  const time = parseTimeOfDayParts(timePart)
  if (time === null) {
    // 理論上不會發生（前面已排除空字串），保險處理
    return {
      ok: true,
      start: { value: date.value, precision: 'day', raw: originalRaw },
      warnings,
    }
  }
  if ('error' in time) {
    return { ok: false, raw: originalRaw, reason: time.error }
  }

  const start: AbsoluteTimePoint = {
    value: `${date.value}T${pad2(time.start.hh)}:${pad2(time.start.mm)}`,
    precision: 'minute',
    raw: originalRaw,
  }

  // "09:00-18:00" → start 取 09:00、end 取 18:00（同日）
  if (time.end) {
    return {
      ok: true,
      start,
      end: {
        value: `${date.value}T${pad2(time.end.hh)}:${pad2(time.end.mm)}`,
        precision: 'minute',
      },
      warnings,
    }
  }

  return { ok: true, start, warnings }
}
