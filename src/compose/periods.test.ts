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

const draft = (title: string, startYear: string, endYear = '') => ({ title, startYear, endYear })

describe('periodDraftError：新增時期的表單檢查', () => {
  it('填對了回傳 null；迄年可以留白（至今）', () => {
    expect(periodDraftError(draft('戒嚴時期', '1949', '1987'))).toBeNull()
    expect(periodDraftError(draft('政黨輪替後', '2000'))).toBeNull()
  })
  it('沒名稱、年份不是四位數、迄年早於起年 → 說明哪裡不對', () => {
    expect(periodDraftError(draft(' ', '1949'))).toContain('名稱')
    expect(periodDraftError(draft('A', '49'))).toContain('起年')
    expect(periodDraftError(draft('A', '1949', '87'))).toContain('迄年')
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
