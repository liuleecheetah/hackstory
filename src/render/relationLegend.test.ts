import { describe, expect, it } from 'vitest'
import type { HstEvent, TimelineDocument } from '../core'
import { legendRows } from './ExportFooter'
import { THEMES } from './theme'
import { relationDash, relationTypesIn } from './timelineData'
import type { TimelineSource } from './types'

const ev = (id: string, track = 't'): HstEvent => ({
  id,
  track,
  title: id,
  start: { value: '2000', precision: 'year' },
})

function src(relations: TimelineDocument['relations'], events = [ev('a'), ev('b'), ev('c')]): TimelineSource {
  return {
    id: 'layer-1',
    doc: { hackstory: '0.5', id: 'd', meta: { title: 'd' }, tracks: [{ id: 't', title: 't' }], events, relations },
  }
}

describe('關係線的樣式與圖例', () => {
  it('五種關係各有不同的線型（不用顏色區分）；「導致」是實線', () => {
    const dashes = ['causes', 'responds_to', 'derives_from', 'contradicts', 'same_event'].map((t) =>
      relationDash(t),
    )
    expect(dashes[0]).toBeUndefined()
    expect(new Set(dashes).size).toBe(5)
    // 「同一事件」沿用原本的虛線，主畫面看起來跟以前一樣
    expect(relationDash('same_event')).toBe('4 3')
    // 字放大時虛線也等比例放大
    expect(relationDash('responds_to', 2)).toBe('20 8')
  })

  it('圖例只列圖上真的有的類型，依固定順序', () => {
    const s = src([
      { from: 'b', to: 'c', type: 'contradicts' },
      { from: 'a', to: 'b', type: 'causes' },
      { from: 'a', to: 'c', type: 'causes' },
    ])
    expect(relationTypesIn([s])).toEqual(['causes', 'contradicts'])
  })

  it('一端的事件沒畫出來（例如軸線被隱藏）的關係不算', () => {
    const s = src([{ from: 'a', to: 'gone', type: 'responds_to' }])
    expect(relationTypesIn([s])).toEqual([])
  })

  it('窄圖放不下一排時，圖例換到下一排', () => {
    const all = ['causes', 'responds_to', 'derives_from', 'contradicts', 'same_event']
    expect(legendRows(all, 960, THEMES.screen)).toHaveLength(1)
    expect(legendRows(all, 300, THEMES.presentation).length).toBeGreaterThan(1)
    expect(legendRows([], 960, THEMES.screen)).toEqual([])
  })
})
