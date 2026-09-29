import { describe, expect, it } from 'vitest'
import type { TimelineDocument } from '../core'
import type { TimelineSource } from '../render/types'
import { featuredOnly, linkedOnly } from './sourceFilters'

const doc: TimelineDocument = {
  hackstory: '0.4',
  id: 'd',
  meta: { title: 'd' },
  tracks: [{ id: 't', title: 't' }],
  events: [
    { id: 'a', track: 't', title: '關鍵', start: { value: '2000', precision: 'year' }, featured: true },
    { id: 'b', track: 't', title: '一般', start: { value: '2001', precision: 'year' } },
  ],
}

describe('featuredOnly：只放關鍵事件', () => {
  it('只留 featured 的事件，軸線照舊', () => {
    const [s] = featuredOnly([{ id: 'L', doc }])
    expect(s.doc.events.map((e) => e.id)).toEqual(['a'])
    expect(s.doc.tracks).toEqual(doc.tracks)
  })

  it('保留完整文件給相對時間求解；已有 fullDoc（隱藏了軸線）時沿用它', () => {
    expect(featuredOnly([{ id: 'L', doc }])[0].fullDoc).toBe(doc)
    const full = { ...doc, id: 'full' }
    const src: TimelineSource = { id: 'L', doc, fullDoc: full }
    expect(featuredOnly([src])[0].fullDoc).toBe(full)
  })
})

describe('linkedOnly：只放有關係線的事件', () => {
  const ev = (id: string, track = 't') => ({
    id,
    track,
    title: id,
    start: { value: '2000', precision: 'year' as const },
  })
  const linkedDoc: TimelineDocument = {
    hackstory: '0.4',
    id: 'd',
    meta: { title: 'd' },
    tracks: [
      { id: 't', title: 't' },
      { id: 'u', title: 'u' },
    ],
    events: [ev('a'), ev('b'), ev('c'), ev('d', 'u')],
    relations: [
      { from: 'a', to: 'b', type: 'causes' },
      { from: 'c', to: 'd', type: 'causes' },
    ],
  }

  it('只留兩端都在的事件，沒有關係線的拿掉', () => {
    const doc = { ...linkedDoc, events: [...linkedDoc.events, ev('lonely')] }
    const [s] = linkedOnly([{ id: 'L', doc }])
    expect(s.doc.events.map((e) => e.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('另一端被隱藏（不在文件的事件裡）就不算', () => {
    const doc = { ...linkedDoc, events: linkedDoc.events.filter((e) => e.track === 't') }
    const [s] = linkedOnly([{ id: 'L', doc }])
    expect(s.doc.events.map((e) => e.id)).toEqual(['a', 'b'])
  })

  it('另一端不在圖上（例如時間範圍外）也不算', () => {
    const [s] = linkedOnly([{ id: 'L', doc: linkedDoc }], (_sid, id) => id !== 'b')
    expect(s.doc.events.map((e) => e.id)).toEqual(['c', 'd'])
  })

  it('跨文件的關係線不算；保留完整文件給相對時間求解', () => {
    const doc = { ...linkedDoc, relations: [{ from: 'a', to: 'b', toDoc: 'other-doc', type: 'causes' as const }] }
    const [s] = linkedOnly([{ id: 'L', doc }])
    expect(s.doc.events).toEqual([])
    expect(s.fullDoc).toBe(doc)
  })
})
