import { describe, expect, it } from 'vitest'
import { sourcesFromRows } from './eventSources'

describe('sourcesFromRows：事件表單的資料來源', () => {
  it('有名稱或網址的列才留下；兩欄都空的列丟掉', () => {
    expect(
      sourcesFromRows([
        { title: '中央社 2019/5/17', url: 'https://www.cna.com.tw/news/1' },
        { title: '', url: '' },
        { title: '立法院議事錄', url: '' },
        { title: '', url: 'https://example.org/a' },
      ]),
    ).toEqual({
      sources: [
        { title: '中央社 2019/5/17', url: 'https://www.cna.com.tw/news/1' },
        { title: '立法院議事錄' },
        { url: 'https://example.org/a' },
      ],
    })
  })

  it('前後空白會去掉', () => {
    expect(sourcesFromRows([{ title: '  報導者 ', url: ' https://x.org ' }])).toEqual({
      sources: [{ title: '報導者', url: 'https://x.org' }],
    })
  })

  it('網址不是 http(s) 開頭 → 回報錯誤，不默默存進去', () => {
    const r = sourcesFromRows([{ title: 'A', url: 'www.cna.com.tw' }])
    expect('error' in r && r.error).toContain('http')
  })

  it('全部空白 → 沒有來源', () => {
    expect(sourcesFromRows([{ title: '', url: '' }])).toEqual({ sources: [] })
  })
})
