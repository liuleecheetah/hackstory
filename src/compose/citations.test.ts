import { describe, expect, it } from 'vitest'
import type { TimelineDocument } from '../core'
import { collectCitations } from './citations'

const doc: TimelineDocument = {
  hackstory: '0.5',
  id: 'd',
  meta: { title: 'd' },
  tracks: [{ id: 't', title: 't' }],
  events: [
    {
      id: 'a',
      track: 't',
      title: 'a',
      start: { value: '2000', precision: 'year' },
      sources: [
        { title: '維基百科：美麗島事件', url: 'https://zh.wikipedia.org/wiki/x' },
        { title: '中央社報導' },
      ],
    },
    {
      id: 'b',
      track: 't',
      title: 'b',
      start: { value: '2001', precision: 'year' },
      sources: [
        { title: '同一篇換個名字', url: 'https://zh.wikipedia.org/wiki/x' },
        { title: '中央社報導' },
        { title: '  ' },
      ],
    },
  ],
}

describe('collectCitations：收尾頁的資料來源', () => {
  it('依出現順序列出，同網址或同名稱（沒網址時）只列一次，空白的略過', () => {
    expect(collectCitations([{ id: 'L', doc }])).toEqual([
      { title: '維基百科：美麗島事件', url: 'https://zh.wikipedia.org/wiki/x' },
      { title: '中央社報導' },
    ])
  })

  it('沒有任何來源就是空清單', () => {
    expect(collectCitations([{ id: 'L', doc: { ...doc, events: [] } }])).toEqual([])
  })
})
