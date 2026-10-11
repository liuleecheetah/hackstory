import { describe, expect, it } from 'vitest'
import type { HstEvent, TimelineDocument } from '../core'
import { validateDocument } from '../core'
import { planMoveEvent } from './moveEvent'

const ev = (id: string, track: string, extra: Partial<HstEvent> = {}): HstEvent => ({
  id,
  track,
  title: id,
  start: { value: '1979-12-10', precision: 'day' },
  ...extra,
})

const source: TimelineDocument = {
  hackstory: '0.5',
  id: 'src',
  meta: { title: '共用庫那份' },
  tracks: [{ id: 's1', title: '黨外' }],
  events: [
    ev('a', 's1', { sources: [{ title: '維基百科', url: 'https://zh.wikipedia.org/x' }], featured: true }),
    ev('b', 's1'),
  ],
  relations: [{ from: 'a', to: 'b', type: 'causes' }],
}
const target: TimelineDocument = {
  hackstory: '0.4',
  id: 'mine',
  meta: { title: '我的圖層' },
  tracks: [{ id: 't1', title: '國際處境' }],
  events: [ev('a', 't1')],
}

describe('planMoveEvent：把事件搬到別的圖層', () => {
  it('連同來源、關鍵事件標記一起搬；原圖層拿掉它與連到它的關係線；撞名就換 id；兩份都通過驗證', () => {
    const plan = planMoveEvent(source, target, source.events[0], 't1')
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.source.events.map((e) => e.id)).toEqual(['b'])
    expect(plan.source.relations).toEqual([])
    expect(plan.droppedRelations).toHaveLength(1)
    expect(plan.newId).toBe('a-2')
    const moved = plan.target.events.find((e) => e.id === 'a-2')!
    expect(moved).toMatchObject({ track: 't1', featured: true, sources: source.events[0].sources })
    expect(plan.target.hackstory).toBe('0.5')
    expect(validateDocument(plan.source).errors).toEqual([])
    expect(validateDocument(plan.target).errors).toEqual([])
  })

  it('相對時間的事件不能搬', () => {
    const rel = ev('r', 's1', { start: { relative: { after: 'b' } } })
    const plan = planMoveEvent({ ...source, events: [...source.events, rel] }, target, rel, 't1')
    expect(plan.ok).toBe(false)
  })

  it('原圖層有事件的相對時間以它為參考時不能搬', () => {
    const dep = ev('d', 's1', { start: { relative: { after: 'a' } } })
    const plan = planMoveEvent({ ...source, events: [...source.events, dep] }, target, source.events[0], 't1')
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.reason).toContain('「d」')
  })

  it('目標軸線不存在就不搬', () => {
    expect(planMoveEvent(source, target, source.events[0], 'nope').ok).toBe(false)
  })
})
