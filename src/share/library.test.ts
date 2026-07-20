// share 層測試：共用庫目錄的解析與網址解析
import { describe, expect, it } from 'vitest'
import { parseLibraryIndex, resolveLibraryUrl } from './library'

const validIndex = JSON.stringify({
  version: 1,
  entries: [
    {
      id: 'tw-228-incident',
      title: '二二八事件',
      description: '三軸並排',
      topics: ['歷史'],
      period: '1945–1995',
      url: 'examples/228-incident.hst.json',
    },
    { id: 'minimal', title: '最小合法目錄項', url: 'https://example.com/a.hst.json' },
  ],
})

describe('parseLibraryIndex', () => {
  it('解析合法目錄，選填欄位缺了也沒關係', () => {
    const result = parseLibraryIndex(validIndex)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.entries).toHaveLength(2)
    expect(result.entries[0].title).toBe('二二八事件')
    expect(result.entries[0].topics).toEqual(['歷史'])
    expect(result.entries[1].description).toBeUndefined()
  })

  it('不是 JSON → 回報錯誤，不會炸掉', () => {
    const result = parseLibraryIndex('這不是 JSON')
    expect(result).toEqual({ ok: false, error: '共用庫目錄不是有效的 JSON' })
  })

  it('缺少 entries 清單 → 回報錯誤', () => {
    const result = parseLibraryIndex('{"version":1}')
    expect(result).toEqual({ ok: false, error: '共用庫目錄缺少 entries 清單' })
  })

  it('某一筆缺 url → 指出是第幾筆', () => {
    const broken = JSON.stringify({ entries: [{ id: 'a', title: '有標題沒網址' }] })
    const result = parseLibraryIndex(broken)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('第 1 筆')
  })

  it('空白字串視同缺欄位（防止目錄裡的手滑）', () => {
    const broken = JSON.stringify({ entries: [{ id: 'a', title: '  ', url: 'x.json' }] })
    expect(parseLibraryIndex(broken).ok).toBe(false)
  })
})

describe('resolveLibraryUrl', () => {
  it('相對路徑相對於網站網址解析', () => {
    expect(resolveLibraryUrl('examples/a.hst.json', 'https://site.tw/hackstory/')).toBe(
      'https://site.tw/hackstory/examples/a.hst.json',
    )
  })

  it('完整網址原樣保留', () => {
    expect(resolveLibraryUrl('https://other.tw/b.hst.json', 'https://site.tw/')).toBe(
      'https://other.tw/b.hst.json',
    )
  })
})
