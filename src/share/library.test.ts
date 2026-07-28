// share 層測試：共用庫目錄的解析與網址解析
import { describe, expect, it } from 'vitest'
import { checkEntryMatchesDocument, parseLibraryIndex, resolveLibraryUrl } from './library'

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
    const broken = JSON.stringify({ version: 1, entries: [{ id: 'a', title: '有標題沒網址' }] })
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

describe('目錄完整性檢查（版本、重複 id、與檔案是否相符）', () => {
  it('缺少 version → 錯誤', () => {
    const text = JSON.stringify({ entries: [] })
    const result = parseLibraryIndex(text)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('version')
  })

  it('version 比程式支援的新 → 錯誤，並請使用者更新程式', () => {
    const text = JSON.stringify({ version: 99, entries: [] })
    const result = parseLibraryIndex(text)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('99')
    expect(result.error).toContain('更新程式')
  })

  it('id 重複 → 錯誤，並指出是第幾筆與第幾筆', () => {
    const text = JSON.stringify({
      version: 1,
      entries: [
        { id: 'same-id', title: '第一筆', url: 'a.hst.json' },
        { id: 'other', title: '第二筆', url: 'b.hst.json' },
        { id: 'same-id', title: '第三筆', url: 'c.hst.json' },
      ],
    })
    const result = parseLibraryIndex(text)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('same-id')
    expect(result.error).toContain('第 3 筆')
    expect(result.error).toContain('第 1 筆')
  })

  it('checkEntryMatchesDocument：目錄 id 與檔案 id 相符 → null', () => {
    expect(checkEntryMatchesDocument({ id: 'abc', title: '某軸' }, 'abc')).toBeNull()
  })

  it('checkEntryMatchesDocument：不相符 → 中文說明，兩個 id 都講出來', () => {
    const msg = checkEntryMatchesDocument({ id: 'abc', title: '某軸' }, 'xyz')
    expect(msg).not.toBeNull()
    expect(msg).toContain('abc')
    expect(msg).toContain('xyz')
    expect(msg).toContain('某軸')
  })
})
