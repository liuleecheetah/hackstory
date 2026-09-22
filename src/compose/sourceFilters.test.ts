import { describe, expect, it } from 'vitest'
import type { TimelineDocument } from '../core'
import type { TimelineSource } from '../render/types'
import { featuredOnly } from './sourceFilters'

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
