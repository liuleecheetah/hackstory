import { describe, expect, it } from 'vitest'
import type { TimelineDocument } from '../core'
import { validateDocument } from '../core'
import {
  addPeriodToDoc,
  periodDraftError,
  periodYears,
  removePeriodFromDoc,
  renamePeriodInDoc,
  withPeriodVersion,
} from './periods'

const baseDoc = (): TimelineDocument => ({
  hackstory: '0.4',
  id: 'doc',
  meta: { title: '測試', license: 'CC-BY-4.0' },
  tracks: [{ id: 't', title: '主軸' }],
  events: [],
})

const draft = (title: string, start: string, end = '') => ({ title, start, end })

describe('periodDraftError：新增時期的表單檢查', () => {
  it('填對了回傳 null；迄年可以留白（至今）', () => {
    expect(periodDraftError(draft('戒嚴時期', '1949', '1987'))).toBeNull()
    expect(periodDraftError(draft('政黨輪替後', '2000'))).toBeNull()
  })
  it('沒名稱、年份不是四位數、迄年早於起年 → 說明哪裡不對', () => {
    expect(periodDraftError(draft(' ', '1949'))).toContain('名稱')
    expect(periodDraftError(draft('A', ''))).toContain('開始時間')
    expect(periodDraftError(draft('A', 'abc'))).toContain('開始時間')
    expect(periodDraftError(draft('A', '1949', 'xyz'))).toContain('結束時間')
    expect(periodDraftError(draft('A', '1987', '1949'))).toContain('早於')
  })
})

describe('addPeriodToDoc', () => {
  it('新增後依起始年份排序、自動給 id，文件版本升到 0.5，且通過 SPEC 驗證', () => {
    let doc = addPeriodToDoc(baseDoc(), draft('解嚴後', '1987'))
    doc = addPeriodToDoc(doc, draft('戒嚴時期', '1949', '1987'))
    expect(doc.periods?.map((p) => p.title)).toEqual(['戒嚴時期', '解嚴後'])
    expect(new Set(doc.periods?.map((p) => p.id)).size).toBe(2)
    expect(doc.hackstory).toBe('0.5')
    expect(doc.periods?.[1].end).toBeUndefined()
    const result = validateDocument(doc)
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it('不修改原本的文件（復原要靠舊的那份）', () => {
    const before = baseDoc()
    addPeriodToDoc(before, draft('A', '2000'))
    expect(before.periods).toBeUndefined()
    expect(before.hackstory).toBe('0.4')
  })
})

describe('改名與刪除', () => {
  const doc = addPeriodToDoc(addPeriodToDoc(baseDoc(), draft('A', '1949', '1987')), draft('B', '1987'))

  it('改名只動那一個；空白名稱不改', () => {
    const renamed = renamePeriodInDoc(doc, 1, '解嚴後')
    expect(renamed.periods?.map((p) => p.title)).toEqual(['A', '解嚴後'])
    expect(renamePeriodInDoc(doc, 1, '  ')).toBe(doc)
  })

  it('刪除只拿掉那一個；刪到一個不剩就把欄位拿掉', () => {
    const one = removePeriodFromDoc(doc, 0)
    expect(one.periods?.map((p) => p.title)).toEqual(['B'])
    const none = removePeriodFromDoc(one, 0)
    expect('periods' in none).toBe(false)
  })
})

describe('其他', () => {
  it('比 0.5 新的版本不動', () => {
    expect(withPeriodVersion({ ...baseDoc(), hackstory: '0.7' }).hackstory).toBe('0.7')
  })
  it('面板上的年份範圍', () => {
    const doc = addPeriodToDoc(addPeriodToDoc(baseDoc(), draft('A', '1949', '1987')), draft('B', '2000'))
    expect(doc.periods!.map(periodYears)).toEqual(['1949–1987', '2000–至今'])
  })
})

describe('時期可以填到月、日', () => {
  it('年/月/日、年/月、中文日期都讀得懂；結束不能早於開始', () => {
    expect(periodDraftError(draft('戒嚴時期', '1949/5/20', '1987/7/15'))).toBeNull()
    expect(periodDraftError(draft('A', '1971/10'))).toBeNull()
    expect(periodDraftError(draft('A', '1949年5月20日'))).toBeNull()
    expect(periodDraftError(draft('A', '1987/7/15', '1949/5/20'))).toContain('早於')
    // 同一年內：只寫年的開始，配上同年的某一天結束，是合理的
    expect(periodDraftError(draft('A', '1949', '1949/12/31'))).toBeNull()
  })

  it('不收幾點幾分', () => {
    expect(periodDraftError(draft('A', '1949/5/20 09:00'))).toContain('開始時間')
  })

  it('存成對應精度的時間點、依真正的先後排序，且通過 SPEC 驗證', () => {
    let doc = addPeriodToDoc(baseDoc(), draft('解嚴後', '1987/7/15'))
    doc = addPeriodToDoc(doc, draft('戒嚴時期', '1949/5/20', '1987/7/15'))
    doc = addPeriodToDoc(doc, draft('外交孤立期', '1971/10', '1979'))
    expect(doc.periods?.map((p) => p.title)).toEqual(['戒嚴時期', '外交孤立期', '解嚴後'])
    expect(doc.periods?.[0].start).toEqual({ value: '1949-05-20', precision: 'day' })
    expect(doc.periods?.[1].start).toEqual({ value: '1971-10', precision: 'month' })
    expect(doc.periods?.[1].end).toEqual({ value: '1979', precision: 'year' })
    expect(validateDocument(doc).errors).toEqual([])
  })

  it('面板顯示去掉月日前面的 0', () => {
    const doc = addPeriodToDoc(baseDoc(), draft('戒嚴時期', '1949/5/20', '1987/7/15'))
    expect(periodYears(doc.periods![0])).toBe('1949/5/20–1987/7/15')
  })
})
