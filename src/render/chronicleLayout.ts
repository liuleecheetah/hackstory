// render 層：版型 D「直式大事記」卡片的排版（純函式，沒有畫面、沒有 React）
//
// 大事記不照時間比例排：每個事件是一張高度不一的卡片（標題、摘要、查證程度、來源清單），
// 依時間先後一張接一張往下排；年份換了，就在那張卡片左側的日期欄寫上大字年份。
// 因為間距不代表時間長短，圖上一定要標示「依先後排列」（誠實原則），那由繪製端負責。
//
// 這裡只回答：每張卡片放在哪、多高、文字折成幾行、放不下的有幾件。

import { wrapLines } from './layout'

/** 一個要做成卡片的事件（文字都已準備好） */
export interface ChronicleEntry {
  key: string
  /** 所屬年份：換年時在日期欄寫大字年份；相對時間等無法確定年份的事件為 null（不寫） */
  year: number | null
  /** 左欄的日期文字（跟年份一模一樣時——例如只知道年份——就不重複寫） */
  date: string
  title: string
  /** 摘要（description），可為空 */
  summary: string
  /** 查證程度，例如「已查證」；沒有標註或使用者選擇不顯示時為空字串 */
  confidence: string
  /** 來源清單的文字，例如「來源：司法院釋字第 748 號、立法院公報」；沒有來源為空字串 */
  sourcesText: string
  /** 多軸時標出這張卡片屬於哪一條軸線；單軸為 null */
  trackLabel: string | null
  color: string
  isKey: boolean
  /** 相對時間推估的位置（日期前加「約」、圓點畫成虛線） */
  estimate: boolean
}

/** 排版需要的尺寸（全部已乘上主題倍率） */
export interface ChronicleMetrics {
  width: number
  /** 可用的垂直範圍（標題列以下、出處行以上） */
  top: number
  bottom: number
  padX: number
  /** 左側日期欄寬 */
  dateColW: number
  cardPad: number
  cardGap: number
  titleFont: number
  summaryFont: number
  metaFont: number
  /** 日期欄的年份大字與日期小字 */
  yearFont: number
  dateFont: number
  /** 行高倍率 */
  lineHeight: number
}

export interface ChronicleRow {
  y: number
  h: number
  x: number
  w: number
  entry: ChronicleEntry
  titleLines: string[]
  summaryLines: string[]
  /** 來源清單折行後的文字（最多兩行） */
  sourceLines: string[]
  /** 這張卡片是新的一年：日期欄要寫大字年份 */
  showYear: boolean
  /** 日期欄的小字日期：年份已由大字帶出，這裡只寫月日（只知道年份時為空字串） */
  dateText: string
}

export interface ChronicleLayout {
  rows: ChronicleRow[]
  /** 放不下的事件數（畫布高度不夠） */
  hidden: number
}

/**
 * 依先後把卡片排進畫布；超出底部的卡片不畫，數量回報在 hidden。
 * entries 須已依要呈現的順序排好（由舊到新，或「最新的在上面」時由新到舊）。
 */
export function layoutChronicle(entries: ChronicleEntry[], m: ChronicleMetrics): ChronicleLayout {
  const rows: ChronicleRow[] = []
  const x = m.padX + m.dateColW
  const w = Math.max(40, m.width - x - m.padX)
  const textW = w - m.cardPad * 2
  const lh = (f: number) => f * m.lineHeight

  let y = m.top
  let lastYear: number | null = null
  let placed = 0

  for (const entry of entries) {
    const showYear = entry.year !== null && entry.year !== lastYear
    const dateText = shortDate(entry)
    const titleLines = wrapLines(entry.title, textW, m.titleFont, 2)
    const summaryLines = entry.summary ? wrapLines(entry.summary, textW, m.summaryFont, 2) : []
    // 小字區：一行「軸線 · 查證程度」，加上最多兩行來源清單
    const metaLine = entry.confidence || entry.trackLabel ? 1 : 0
    const sourceLines = entry.sourcesText ? wrapLines(entry.sourcesText, textW, m.metaFont, 2) : []
    const cardH =
      m.cardPad * 2 +
      titleLines.length * lh(m.titleFont) +
      summaryLines.length * lh(m.summaryFont) +
      (metaLine + sourceLines.length) * lh(m.metaFont)
    // 日期欄（大字年份＋小字日期）也要放得下
    const dateColH =
      m.cardPad + (showYear ? lh(m.yearFont) : 0) + (dateText ? lh(m.dateFont) : 0)
    const h = Math.max(cardH, dateColH)
    if (y + h > m.bottom) break

    if (showYear) lastYear = entry.year
    rows.push({ y, h, x, w, entry, titleLines, summaryLines, sourceLines, showYear, dateText })
    y += h + m.cardGap
    placed++
  }

  return { rows, hidden: entries.length - placed }
}

/**
 * 日期欄的小字：年份由大字（該年第一張卡片旁）帶出，這裡去掉年份只留月日，
 * 讀起來跟紙本大事記一樣；只知道年份的事件就不重複寫。
 */
export function shortDate(entry: Pick<ChronicleEntry, 'year' | 'date'>): string {
  if (entry.year === null) return entry.date
  const y = String(entry.year)
  if (entry.date === y) return ''
  if (entry.date.startsWith(`${y}/`)) return entry.date.slice(y.length + 1)
  return entry.date
}

/** 查證程度的中文（與詳情卡用語一致） */
export const CONFIDENCE_LABELS: Record<string, string> = {
  verified: '已查證',
  reported: '據報導',
  disputed: '有爭議',
  unknown: '未確認',
}

/** 查證程度的中文；沒有標註就是空字串 */
export function confidenceLabel(confidence: string | undefined): string {
  return confidence ? (CONFIDENCE_LABELS[confidence] ?? '') : ''
}

/** 一則來源在卡片上的名稱：有標題用標題，只有網址就寫網站名稱 */
export function sourceName(source: { title?: string; url?: string }): string {
  const title = source.title?.trim()
  if (title) return title
  if (!source.url) return ''
  try {
    return new URL(source.url).hostname.replace(/^www\./, '')
  } catch {
    return source.url
  }
}

/** 卡片上的來源清單：「來源：A、B、C」；重複的只列一次，沒有來源回傳空字串 */
export function sourcesText(sources: Array<{ title?: string; url?: string }> | undefined): string {
  const names = [...new Set((sources ?? []).map(sourceName).filter(Boolean))]
  return names.length > 0 ? `來源：${names.join('、')}` : ''
}
