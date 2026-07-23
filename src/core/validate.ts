// core 層：.hst.json 文件驗證器
// 讀進一個未知的 JSON 物件，檢查它是否符合 SPEC.md 的格式。
// 原則：
// 1. 錯誤訊息用繁體中文，並附上出錯位置（path），之後介面直接顯示給使用者。
// 2. 不認識的欄位保留不動（forward compatibility，SPEC 第 10 節）——驗證器只檢查、不刪改。

import type {
  Precision,
  TimelineDocument,
} from './types'
import { checkCalendarValue } from './time'

/** 一筆驗證問題：出錯位置 + 中文說明 */
export interface ValidationIssue {
  /** 例如 "events[3].start.value" */
  path: string
  message: string
}

export interface ValidationResult {
  /** 沒有任何 error 才為 true（warning 不影響） */
  ok: boolean
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
  /** ok 時提供型別化的文件（就是原物件，未刪改任何欄位） */
  doc?: TimelineDocument
}

// 本程式支援的規格版本
const SUPPORTED_MAJOR = 0
const SUPPORTED_MINOR = 3

const PRECISIONS: Precision[] = ['year', 'month', 'day', 'minute']
const CONFIDENCES = ['verified', 'reported', 'disputed', 'unknown']
const RELATION_TYPES = ['causes', 'responds_to', 'derives_from', 'contradicts', 'same_event']
const ORIENTATIONS = ['horizontal', 'vertical']
const SCALES = ['day', 'week', 'month', 'year']
const MEDIA_TYPES = ['image', 'video', 'document']

/** value 必須符合 precision 對應的格式（SPEC 第 4 節） */
const VALUE_FORMAT: Record<Precision, RegExp> = {
  year: /^\d{4}$/,
  month: /^\d{4}-\d{2}$/,
  day: /^\d{4}-\d{2}-\d{2}$/,
  minute: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/,
}

// id 用 slug：英數與連字號
const RE_SLUG = /^[A-Za-z0-9][A-Za-z0-9-]*$/

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== ''
}

/**
 * 比較兩個絕對時間值的先後。精度不同時只比較共同的前綴，
 * 避免「2016-11-24」與「2016-11-24T09:00」被誤判成一前一後。
 */
function comparePointValues(a: string, b: string): number {
  const n = Math.min(a.length, b.length)
  const aa = a.slice(0, n)
  const bb = b.slice(0, n)
  return aa < bb ? -1 : aa > bb ? 1 : 0
}

/** 驗證一個 .hst.json 文件（傳入 JSON.parse 的結果） */
export function validateDocument(data: unknown): ValidationResult {
  const errors: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []
  const err = (path: string, message: string) => errors.push({ path, message })
  const warn = (path: string, message: string) => warnings.push({ path, message })

  if (!isObject(data)) {
    err('', '檔案內容不是一個 JSON 物件')
    return { ok: false, errors, warnings }
  }

  // ---- hackstory 版本號 ----
  if (!isNonEmptyString(data.hackstory)) {
    err('hackstory', '缺少規格版本號 hackstory（例如 "0.1"）')
  } else {
    const m = data.hackstory.match(/^(\d+)\.(\d+)$/)
    if (!m) {
      err('hackstory', `版本號「${data.hackstory}」格式錯誤，應為 major.minor（例如 "0.1"）`)
    } else {
      const major = Number(m[1])
      const minor = Number(m[2])
      if (major !== SUPPORTED_MAJOR) {
        err('hackstory', `不支援的主版本 ${major}（本程式支援 ${SUPPORTED_MAJOR}.x）`)
      } else if (minor > SUPPORTED_MINOR) {
        warn(
          'hackstory',
          `檔案版本 ${data.hackstory} 比本程式支援的 ${SUPPORTED_MAJOR}.${SUPPORTED_MINOR} 新，不認識的欄位會保留不動`,
        )
      }
    }
  }

  // ---- id ----
  if (!isNonEmptyString(data.id)) {
    err('id', '缺少全域識別碼 id')
  } else if (!RE_SLUG.test(data.id)) {
    err('id', `id「${data.id}」只能使用英文、數字與連字號（slug）`)
  }

  // ---- meta ----
  if (!isObject(data.meta)) {
    err('meta', '缺少 meta（時間軸的身分證）')
  } else {
    const meta = data.meta
    if (!isNonEmptyString(meta.title)) {
      err('meta.title', '缺少標題 meta.title')
    }
    if (meta.authors !== undefined) {
      if (!Array.isArray(meta.authors)) {
        err('meta.authors', 'authors 應為陣列（支援共筆）')
      } else {
        meta.authors.forEach((a, i) => {
          if (!isObject(a) || !isNonEmptyString(a.name)) {
            err(`meta.authors[${i}]`, '作者需要 name 欄位')
          }
        })
      }
    }
    if (meta.license === undefined) {
      warn('meta.license', '未標示授權。建議填入 CC-BY-4.0，否則別人無法安心取用、混合、再發佈')
    } else if (!isNonEmptyString(meta.license)) {
      err('meta.license', 'license 應為字串（例如 "CC-BY-4.0"）')
    }
    if (meta.revision !== undefined && !Number.isInteger(meta.revision)) {
      err('meta.revision', 'revision 應為整數（單調遞增）')
    }
    if (meta.topics !== undefined && !Array.isArray(meta.topics)) {
      err('meta.topics', 'topics 應為字串陣列')
    }
  }

  // ---- tracks ----
  const trackIds = new Set<string>()
  if (!Array.isArray(data.tracks) || data.tracks.length === 0) {
    err('tracks', 'tracks 至少要有一條軸線')
  } else {
    data.tracks.forEach((t, i) => {
      const path = `tracks[${i}]`
      if (!isObject(t)) {
        err(path, '軸線應為物件')
        return
      }
      if (!isNonEmptyString(t.id)) {
        err(`${path}.id`, '軸線缺少 id')
      } else if (trackIds.has(t.id)) {
        err(`${path}.id`, `軸線 id「${t.id}」重複（同一份文件內必須唯一）`)
      } else {
        trackIds.add(t.id)
      }
      if (!isNonEmptyString(t.title)) {
        err(`${path}.title`, '軸線缺少 title')
      }
      if (t.order !== undefined && typeof t.order !== 'number') {
        err(`${path}.order`, 'order 應為數字')
      }
    })
  }

  // ---- events ----
  const eventIds = new Set<string>()
  if (!Array.isArray(data.events)) {
    err('events', '缺少 events（可為空陣列，但欄位必須存在）')
  } else {
    const events: unknown[] = data.events
    // 先收集所有事件 id，供相對時間錨點與 relations 檢查引用
    for (const e of events) {
      if (isObject(e) && isNonEmptyString(e.id)) eventIds.add(e.id)
    }

    events.forEach((e, i) => {
      const path = `events[${i}]`
      if (!isObject(e)) {
        err(path, '事件應為物件')
        return
      }
      const label = isNonEmptyString(e.title) ? `「${e.title}」` : ''

      if (!isNonEmptyString(e.id)) {
        err(`${path}.id`, `事件${label}缺少 id`)
      }
      if (!isNonEmptyString(e.track)) {
        err(`${path}.track`, `事件${label}缺少所屬軸線 track`)
      } else if (trackIds.size > 0 && !trackIds.has(e.track)) {
        err(`${path}.track`, `事件${label}指向不存在的軸線「${e.track}」`)
      }
      if (!isNonEmptyString(e.title)) {
        err(`${path}.title`, '事件缺少 title（軸上唯一直接顯示的文字）')
      }

      if (e.start === undefined) {
        err(`${path}.start`, `事件${label}缺少開始時間 start`)
      } else {
        validateTimePoint(e.start, `${path}.start`, eventIds, err)
      }
      if (e.end !== undefined && e.end !== null) {
        validateTimePoint(e.end, `${path}.end`, eventIds, err)
        // 區間事件：結束不應早於開始（都是絕對時間才能比較）
        if (
          isObject(e.start) && typeof e.start.value === 'string' &&
          isObject(e.end) && typeof e.end.value === 'string' &&
          comparePointValues(e.end.value, e.start.value) < 0
        ) {
          warn(`${path}.end`, `事件${label}的結束時間早於開始時間`)
        }
      }

      if (e.ongoing !== undefined && typeof e.ongoing !== 'boolean') {
        err(`${path}.ongoing`, 'ongoing 應為 true/false')
      }
      if (e.ongoing === true && e.end !== undefined && e.end !== null) {
        warn(`${path}.ongoing`, `事件${label}同時有結束時間與 ongoing，以結束時間為準`)
      }
      if (e.featured !== undefined && typeof e.featured !== 'boolean') {
        err(`${path}.featured`, 'featured 應為 true/false')
      }
      // importance 為 0.3 之前的舊欄位，仍可讀取但已由 featured 取代
      if (e.importance !== undefined) {
        if (
          typeof e.importance !== 'number' ||
          !Number.isInteger(e.importance) ||
          e.importance < 1 ||
          e.importance > 5
        ) {
          err(`${path}.importance`, 'importance 應為 1–5 的整數')
        }
        if (e.featured !== undefined) {
          warn(
            `${path}.importance`,
            `事件${label}同時有 featured 與舊欄位 importance，以 featured 為準（建議移除 importance）`,
          )
        }
      }
      if (e.confidence !== undefined && !CONFIDENCES.includes(e.confidence as string)) {
        err(`${path}.confidence`, `confidence「${String(e.confidence)}」不在允許值中（${CONFIDENCES.join(' / ')}）`)
      }
      if (e.tags !== undefined && !Array.isArray(e.tags)) {
        err(`${path}.tags`, 'tags 應為字串陣列')
      }
      if (e.sources !== undefined) {
        if (!Array.isArray(e.sources)) {
          err(`${path}.sources`, 'sources 應為陣列')
        } else {
          e.sources.forEach((s, j) => {
            if (!isObject(s)) err(`${path}.sources[${j}]`, '來源應為 { title, url } 物件')
          })
        }
      }
      if (e.media !== undefined) {
        if (!Array.isArray(e.media)) {
          err(`${path}.media`, 'media 應為陣列')
        } else {
          e.media.forEach((m, j) => {
            if (!isObject(m) || !MEDIA_TYPES.includes(m.type as string) || !isNonEmptyString(m.url)) {
              err(`${path}.media[${j}]`, `media 需要 type（${MEDIA_TYPES.join(' / ')}）與 url`)
            }
          })
        }
      }
      if (e.location !== undefined) {
        if (!isObject(e.location) || !isNonEmptyString(e.location.name)) {
          err(`${path}.location`, 'location 需要 name 欄位')
        }
      }

      // 事件 id 重複檢查（放最後，確保訊息帶上標題方便辨認）
      if (isNonEmptyString(e.id)) {
        const seenBefore = events
          .slice(0, i)
          .some((prev) => isObject(prev) && prev.id === e.id)
        if (seenBefore) {
          err(`${path}.id`, `事件 id「${e.id}」重複（一旦發佈就不可改，必須唯一）`)
        }
      }
    })
  }

  // ---- relations ----
  if (data.relations !== undefined) {
    if (!Array.isArray(data.relations)) {
      err('relations', 'relations 應為陣列')
    } else {
      data.relations.forEach((r, i) => {
        const path = `relations[${i}]`
        if (!isObject(r)) {
          err(path, '關係應為物件')
          return
        }
        if (!isNonEmptyString(r.from) || !eventIds.has(r.from)) {
          err(`${path}.from`, `關係的 from「${String(r.from ?? '')}」不是存在的事件 id`)
        }
        if (!isNonEmptyString(r.to) || !eventIds.has(r.to)) {
          err(`${path}.to`, `關係的 to「${String(r.to ?? '')}」不是存在的事件 id`)
        }
        if (!RELATION_TYPES.includes(r.type as string)) {
          err(`${path}.type`, `關係類型「${String(r.type)}」不在允許值中（${RELATION_TYPES.join(' / ')}）`)
        }
      })
    }
  }

  // ---- display ----
  if (data.display !== undefined) {
    if (!isObject(data.display)) {
      err('display', 'display 應為物件')
    } else {
      const d = data.display
      if (d.orientation !== undefined && !ORIENTATIONS.includes(d.orientation as string)) {
        err('display.orientation', `orientation「${String(d.orientation)}」應為 ${ORIENTATIONS.join(' / ')}`)
      }
      if (d.defaultScale !== undefined && !SCALES.includes(d.defaultScale as string)) {
        err('display.defaultScale', `defaultScale「${String(d.defaultScale)}」應為 ${SCALES.join(' / ')}`)
      }
      if (d.collapseGaps !== undefined && typeof d.collapseGaps !== 'boolean') {
        err('display.collapseGaps', 'collapseGaps 應為 true/false')
      }
    }
  }

  const ok = errors.length === 0
  return {
    ok,
    errors,
    warnings,
    // 不刪改任何欄位，原物件直接視為文件（不認識的欄位自然保留）
    doc: ok ? (data as unknown as TimelineDocument) : undefined,
  }
}

/** 驗證一個 TimePoint：絕對時間或相對錨點 */
function validateTimePoint(
  point: unknown,
  path: string,
  eventIds: Set<string>,
  err: (path: string, message: string) => void,
): void {
  if (!isObject(point)) {
    err(path, '時間點應為物件（{ value, precision } 或 { relative }）')
    return
  }

  // 相對時間錨點（Phase 2 繪製，但格式現在就接受）
  if ('relative' in point) {
    const rel = point.relative
    if (!isObject(rel)) {
      err(`${path}.relative`, 'relative 應為物件（{ after, before }）')
      return
    }
    if (rel.after === undefined && rel.before === undefined) {
      err(`${path}.relative`, '相對時間至少要有 after 或 before 其中之一')
    }
    for (const key of ['after', 'before'] as const) {
      const ref = rel[key]
      if (ref !== undefined) {
        if (!isNonEmptyString(ref)) {
          err(`${path}.relative.${key}`, `${key} 應為事件 id 字串`)
        } else if (!eventIds.has(ref)) {
          err(`${path}.relative.${key}`, `${key} 指向不存在的事件「${ref}」`)
        }
      }
    }
    return
  }

  // 絕對時間
  if (!isNonEmptyString(point.value)) {
    err(`${path}.value`, '時間點缺少 value')
    return
  }
  if (!PRECISIONS.includes(point.precision as Precision)) {
    err(`${path}.precision`, `precision「${String(point.precision)}」應為 ${PRECISIONS.join(' / ')}`)
    return
  }
  const precision = point.precision as Precision
  if (!VALUE_FORMAT[precision].test(point.value)) {
    err(
      `${path}.value`,
      `值「${point.value}」不符合 ${precision} 精度的格式（應為 ${formatHint(precision)}）`,
    )
    return
  }
  const calendarError = checkCalendarValue(point.value, precision)
  if (calendarError) {
    err(`${path}.value`, calendarError)
  }
  if (point.circa !== undefined && typeof point.circa !== 'boolean') {
    err(`${path}.circa`, 'circa 應為 true/false')
  }
}

function formatHint(precision: Precision): string {
  switch (precision) {
    case 'year':
      return 'YYYY，例如 "2010"'
    case 'month':
      return 'YYYY-MM，例如 "2010-06"'
    case 'day':
      return 'YYYY-MM-DD，例如 "2017-05-24"'
    case 'minute':
      return 'YYYY-MM-DDTHH:mm，例如 "2016-11-24T09:00"'
  }
}
