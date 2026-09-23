import { describe, expect, it } from 'vitest'
import { eventGroups, MAX_PAGES, planPages } from './splitPages'

/** 假的「放不放得下」：一張最多放 n 個事件群 */
const fitsAtMost = (groups: number[], n: number) => async ([a, b]: [number, number]) =>
  groups.filter((g) => g >= a && g <= b).length <= n

describe('eventGroups', () => {
  it('排序並合併同一時間點', () => {
    expect(eventGroups([5, 1, 3, 1, 5])).toEqual([1, 3, 5])
  })
})

describe('planPages', () => {
  it('全部放得下就只有一張，範圍就是整段', async () => {
    const g = [1, 2, 3]
    expect(await planPages(g, [0, 10], fitsAtMost(g, 5))).toEqual({ ok: true, pages: [[0, 10]] })
  })

  it('依時間前後切成最少張數，分界在兩件事件正中間、整段連續', async () => {
    const g = [1, 2, 3, 4, 5, 6]
    const plan = await planPages(g, [0, 10], fitsAtMost(g, 3))
    expect(plan).toEqual({ ok: true, pages: [[0, 3.5], [3.5, 10]] })
  })

  it('張數最少之外，每張的事件數盡量平均（不會 3＋3＋1）', async () => {
    const g = [1, 2, 3, 4, 5, 6, 7]
    const plan = await planPages(g, [0, 10], fitsAtMost(g, 3))
    if (!plan.ok) throw new Error('應該切得開')
    const counts = plan.pages.map(([a, b]) => g.filter((x) => x >= a && x <= b).length)
    expect(counts).toHaveLength(3)
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1)
    expect(counts.reduce((a, b) => a + b, 0)).toBe(g.length)
  })

  it('每一件事件都落在某一張裡（不遺漏）', async () => {
    const g = [1, 4, 9, 16, 25, 36, 49, 64]
    const plan = await planPages(g, [0, 70], fitsAtMost(g, 2))
    if (!plan.ok) throw new Error('應該切得開')
    for (const x of g) expect(plan.pages.some(([a, b]) => x >= a && x <= b)).toBe(true)
  })

  it('單一時間點就放不下時回報，不硬切', async () => {
    const g = [1, 2]
    expect(await planPages(g, [0, 3], async () => false)).toEqual({ ok: false, reason: 'single-too-big' })
  })

  it('要切超過上限張數時回報', async () => {
    const g = Array.from({ length: MAX_PAGES + 5 }, (_, i) => i)
    expect(await planPages(g, [0, 100], fitsAtMost(g, 1))).toEqual({ ok: false, reason: 'too-many-pages' })
  })

  it('沒有事件就一張整段', async () => {
    expect(await planPages([], [0, 10], async () => true)).toEqual({ ok: true, pages: [[0, 10]] })
  })
})
