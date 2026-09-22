import { describe, expect, it } from 'vitest'
import type { ChronicleEntry, ChronicleMetrics } from './chronicleLayout'
import { confidenceLabel, layoutChronicle, shortDate, sourceName, sourcesText } from './chronicleLayout'

const M: ChronicleMetrics = {
  width: 540,
  top: 100,
  bottom: 900,
  padX: 20,
  dateColW: 90,
  cardPad: 10,
  cardGap: 8,
  titleFont: 13,
  summaryFont: 12,
  metaFont: 10,
  yearFont: 16,
  dateFont: 11,
  lineHeight: 1.4,
}

const entry = (key: string, year: number | null, extra: Partial<ChronicleEntry> = {}): ChronicleEntry => ({
  key,
  year,
  date: `${year}`,
  title: `事件 ${key}`,
  summary: '',
  confidence: '',
  sourcesText: '',
  trackLabel: null,
  color: '#0072b2',
  isKey: false,
  estimate: false,
  ...extra,
})

describe('layoutChronicle：卡片依先後往下排', () => {
  it('年份換了才寫大字年份，同一年的後續卡片不再寫', () => {
    const { rows } = layoutChronicle([entry('a', 1987), entry('b', 1987), entry('c', 1990)], M)
    expect(rows.map((r) => r.showYear)).toEqual([true, false, true])
  })

  it('卡片不重疊、由上往下排，而且都在可用範圍內', () => {
    const { rows } = layoutChronicle(
      Array.from({ length: 8 }, (_, i) => entry(String(i), 2000 + i, { summary: '一段摘要文字'.repeat(4) })),
      M,
    )
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].y).toBeGreaterThanOrEqual(rows[i - 1].y + rows[i - 1].h)
    }
    for (const r of rows) {
      expect(r.y).toBeGreaterThanOrEqual(M.top)
      expect(r.y + r.h).toBeLessThanOrEqual(M.bottom)
    }
  })

  it('有摘要、有來源小標的卡片比較高；摘要最多兩行', () => {
    const { rows } = layoutChronicle(
      [
        entry('plain', null),
        entry('rich', null, {
          summary: '很長的摘要'.repeat(30),
          confidence: '已查證',
          sourcesText: '來源：' + '司法院釋字第 748 號解釋、'.repeat(10),
        }),
      ],
      M,
    )
    const [plain, rich] = rows
    expect(rich.h).toBeGreaterThan(plain.h)
    expect(rich.summaryLines.length).toBe(2)
    // 來源清單最多兩行，超過以刪節號收尾
    expect(rich.sourceLines.length).toBe(2)
    expect(rich.sourceLines[1].endsWith('…')).toBe(true)
  })

  it('畫布放不下時停止，並回報放不下的件數', () => {
    const many = Array.from({ length: 60 }, (_, i) => entry(String(i), 1900 + i))
    const { rows, hidden } = layoutChronicle(many, M)
    const cards = rows.length
    expect(cards).toBeGreaterThan(0)
    expect(cards + hidden).toBe(60)
    expect(hidden).toBeGreaterThan(0)
  })
})

describe('shortDate：日期欄只寫月日', () => {
  it('年份由大字帶出，小字去掉年份；只知道年份就不重複；無年份照原樣', () => {
    expect(shortDate({ year: 1949, date: '1949/6/8' })).toBe('6/8')
    expect(shortDate({ year: 1987, date: '1987' })).toBe('')
    expect(shortDate({ year: 1980, date: '1980年代' })).toBe('1980年代')
    expect(shortDate({ year: null, date: '約 1950' })).toBe('約 1950')
  })
})

describe('查證程度與來源清單', () => {
  it('查證程度轉成中文，沒標註就空白', () => {
    expect(confidenceLabel('verified')).toBe('已查證')
    expect(confidenceLabel('disputed')).toBe('有爭議')
    expect(confidenceLabel(undefined)).toBe('')
  })

  it('來源名稱：有標題用標題，只有網址寫網站名稱', () => {
    expect(sourceName({ title: '立法院公報', url: 'https://ly.gov.tw/x' })).toBe('立法院公報')
    expect(sourceName({ url: 'https://www.cna.com.tw/news/1' })).toBe('cna.com.tw')
    expect(sourceName({})).toBe('')
  })

  it('來源清單：依序列出、重複只列一次、沒有來源就空白', () => {
    expect(
      sourcesText([
        { title: '司法院釋字第 748 號解釋' },
        { url: 'https://www.cna.com.tw/a' },
        { title: '司法院釋字第 748 號解釋' },
      ]),
    ).toBe('來源：司法院釋字第 748 號解釋、cna.com.tw')
    expect(sourcesText([])).toBe('')
    expect(sourcesText(undefined)).toBe('')
  })
})
