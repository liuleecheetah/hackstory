import { describe, expect, it } from 'vitest'
import type { TimelineDocument } from '../core'
import { searchEvents } from './eventSearch'

const doc: TimelineDocument = {
  hackstory: '0.5',
  id: 'd',
  meta: { title: 'd' },
  tracks: [{ id: 't', title: 't' }],
  events: [
    { id: 'a', track: 't', title: '臺灣文化協會成立', start: { value: '1921', precision: 'year' }, tags: ['蔣渭水'] },
    { id: 'b', track: 't', title: '臺灣民眾黨成立', description: '蔣渭水主導', start: { value: '1927', precision: 'year' } },
    { id: 'c', track: 't', title: "Taiwan People's Party", start: { value: '1927', precision: 'year' }, sources: [{ title: '被背叛的台灣 P.157' }] },
  ],
}
const sources = [{ id: 'L', doc }]

describe('searchEvents：找事件', () => {
  it('空字串代表沒在搜尋', () => {
    expect(searchEvents(sources, '  ')).toBeNull()
  })

  it('比對標題、說明與標籤', () => {
    expect(searchEvents(sources, '蔣渭水')).toEqual(new Set(['L/a', 'L/b']))
  })

  it('好幾個關鍵字要全部都出現（全形空白也算分隔）', () => {
    expect(searchEvents(sources, '蔣渭水　民眾黨')).toEqual(new Set(['L/b']))
  })

  it('不分大小寫，也比對出處名稱', () => {
    expect(searchEvents(sources, 'people')).toEqual(new Set(['L/c']))
    expect(searchEvents(sources, 'P.157')).toEqual(new Set(['L/c']))
  })

  it('沒有符合的回傳空集合（不是 null）', () => {
    expect(searchEvents(sources, '林獻堂')).toEqual(new Set())
  })
})
