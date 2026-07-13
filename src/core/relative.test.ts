// 相對時間求解器的測試。
// 這是「只知道先後、不知道日期」也能建時間軸的核心——順序不對就全毀，所以測仔細。
import { describe, expect, it } from 'vitest'
import { resolveRelativeEvents } from './relative'
import type { HstEvent, TimelineDocument } from './types'

/** 建一份測試文件：兩個絕對事件（2020 年初、2021 年初）＋傳入的相對事件 */
function docWith(...events: Partial<HstEvent>[]): TimelineDocument {
  return {
    hackstory: '0.2',
    id: 'test',
    meta: { title: '測試' },
    tracks: [{ id: 'main', title: '主軸' }],
    events: [
      { id: 'A', track: 'main', title: 'Ａ', start: { value: '2020-01-01', precision: 'day' } },
      { id: 'B', track: 'main', title: 'Ｂ', start: { value: '2021-01-01', precision: 'day' } },
      ...(events as HstEvent[]),
    ],
  }
}

const T_A = new Date(2020, 0, 1).getTime()
const T_B = new Date(2021, 0, 1).getTime()

const rel = (id: string, relative: { after?: string; before?: string }): Partial<HstEvent> => ({
  id,
  track: 'main',
  title: id,
  start: { relative },
})

describe('resolveRelativeEvents', () => {
  it('沒有相對事件 → 空結果', () => {
    const result = resolveRelativeEvents(docWith())
    expect(result.positions.size).toBe(0)
    expect(result.unresolved).toEqual([])
  })

  it('夾在兩個絕對事件之間：推估位置嚴格落在 A、B 之間', () => {
    const result = resolveRelativeEvents(docWith(rel('R', { after: 'A', before: 'B' })))
    const t = result.positions.get('R')!
    expect(t).toBeGreaterThan(T_A)
    expect(t).toBeLessThan(T_B)
    expect(result.unresolved).toEqual([])
  })

  it('只有「之後」：畫在參考事件的右邊', () => {
    const result = resolveRelativeEvents(docWith(rel('R', { after: 'B' })))
    expect(result.positions.get('R')!).toBeGreaterThan(T_B)
  })

  it('只有「之前」：畫在參考事件的左邊', () => {
    const result = resolveRelativeEvents(docWith(rel('R', { before: 'A' })))
    expect(result.positions.get('R')!).toBeLessThan(T_A)
  })

  it('同一段區間內的多個相對事件：分散放置、互不重疊', () => {
    const result = resolveRelativeEvents(
      docWith(
        rel('R1', { after: 'A', before: 'B' }),
        rel('R2', { after: 'A', before: 'B' }),
        rel('R3', { after: 'A', before: 'B' }),
      ),
    )
    const ts = ['R1', 'R2', 'R3'].map((id) => result.positions.get(id)!)
    for (const t of ts) {
      expect(t).toBeGreaterThan(T_A)
      expect(t).toBeLessThan(T_B)
    }
    expect(new Set(ts).size).toBe(3) // 三個位置各不相同
  })

  it('相對事件串成鏈：R2 在 R1 之後，畫出來也真的在 R1 右邊', () => {
    const result = resolveRelativeEvents(
      docWith(rel('R1', { after: 'A', before: 'B' }), rel('R2', { after: 'R1', before: 'B' })),
    )
    const t1 = result.positions.get('R1')!
    const t2 = result.positions.get('R2')!
    expect(t1).toBeGreaterThan(T_A)
    expect(t2).toBeGreaterThan(t1)
    expect(t2).toBeLessThan(T_B)
  })

  it('鏈的參考可以一路傳遞到絕對事件：R2 → R1 → A', () => {
    const result = resolveRelativeEvents(
      docWith(rel('R1', { after: 'A' }), rel('R2', { after: 'R1' })),
    )
    const t1 = result.positions.get('R1')!
    const t2 = result.positions.get('R2')!
    expect(t1).toBeGreaterThan(T_A)
    expect(t2).toBeGreaterThan(t1)
  })

  it('互相循環 → 收進 unresolved，不亂畫', () => {
    const result = resolveRelativeEvents(
      docWith(rel('R1', { after: 'R2' }), rel('R2', { after: 'R1' })),
    )
    expect(result.positions.has('R1')).toBe(false)
    expect(result.positions.has('R2')).toBe(false)
    expect(result.unresolved.length).toBe(2)
  })

  it('條件矛盾（在 B 之後、又在 A 之前）→ 收進 unresolved 並說明原因', () => {
    const result = resolveRelativeEvents(docWith(rel('R', { after: 'B', before: 'A' })))
    expect(result.positions.has('R')).toBe(false)
    expect(result.unresolved[0]?.reason).toContain('矛盾')
  })
})
