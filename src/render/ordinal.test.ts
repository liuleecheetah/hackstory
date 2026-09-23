import { describe, expect, it } from 'vitest'
import type { HstEvent, TimelineDocument } from '../core'
import { buildOrdinalWarp, ORDINAL_STEP, ordinalDomain, ordinalTicks } from './ordinal'
import { buildBands, buildTimelineBase } from './timelineData'
import type { TimelineSource } from './types'

const Y = (y: number) => new Date(y, 0, 1).getTime()
const day = (value: string) => ({ value, precision: 'day' as const })

function src(events: HstEvent[], relations: TimelineDocument['relations'] = []): TimelineSource {
  return {
    id: 'layer-1',
    doc: {
      hackstory: '0.4',
      id: 'doc',
      meta: { title: '測試' },
      tracks: [{ id: 'main', title: '主軸' }],
      events,
      relations,
    },
  }
}

describe('buildOrdinalWarp', () => {
  const warp = buildOrdinalWarp([Y(1865), Y(2022), Y(1870), Y(2022), Y(1969)])

  it('每個相異的時間點放在等距的格子上（重複的共用一格）', () => {
    expect(warp.ordinalSlots).toEqual([Y(1865), Y(1870), Y(1969), Y(2022)])
    expect(warp.toU(Y(1865))).toBe(0)
    expect(warp.toU(Y(1870))).toBe(ORDINAL_STEP)
    expect(warp.toU(Y(1969))).toBe(2 * ORDINAL_STEP)
    expect(warp.toU(Y(2022))).toBe(3 * ORDINAL_STEP)
  })

  it('格子之間線性內插，且嚴格遞增、可以反推回真實時間', () => {
    const mid = warp.toU((Y(1870) + Y(1969)) / 2)
    expect(mid).toBeCloseTo(1.5 * ORDINAL_STEP)
    for (const t of [Y(1800), Y(1866), Y(1900), Y(2000), Y(2100)]) {
      expect(warp.toT(warp.toU(t))).toBeCloseTo(t, -3)
    }
    const us = [Y(1800), Y(1865), Y(1866), Y(1950), Y(2022), Y(2100)].map(warp.toU)
    for (let i = 1; i < us.length; i++) expect(us[i]).toBeGreaterThan(us[i - 1])
  })

  it('初始範圍涵蓋所有格子，前後各留一點空', () => {
    const [a, b] = ordinalDomain(warp)
    expect(a).toBeLessThan(0)
    expect(b).toBeGreaterThan(3 * ORDINAL_STEP)
  })

  it('沒有事件時等同直通、不標示非等比格子', () => {
    const w = buildOrdinalWarp([])
    expect(w.toU(123)).toBe(123)
    expect(w.ordinalSlots).toEqual([])
  })
})

describe('ordinalTicks', () => {
  it('每格寫年份；同一年只寫一次；太擠就跳過', () => {
    const slots = [Y(1865), new Date(1865, 5, 1).getTime(), Y(1870), Y(1871)]
    const ticks = ordinalTicks(slots, (t) => slots.indexOf(t) * 30, 40)
    expect(ticks.map((t) => t.label)).toEqual(['1865', '1870'])
  })
})

describe('buildTimelineBase 順序等距', () => {
  const events: HstEvent[] = [
    { id: 'a', track: 'main', title: '早', start: day('1865-01-01') },
    { id: 'b', track: 'main', title: '區間', start: day('1870-03-01'), end: day('1990-01-01') },
    { id: 'c', track: 'main', title: '晚', start: day('2022-11-30'), featured: true },
    { id: 'r', track: 'main', title: '相對', start: { relative: { after: 'a', before: 'c' } } },
  ]
  const s = src(events, [{ from: 'a', to: 'c', type: 'causes' }])
  const base = buildTimelineBase([s], false, true)
  const band = buildBands([s], base, { showDates: false, showYears: false })[0]
  const byId = new Map(band.events.map((e) => [e.ev.id, e]))

  it('每件事件的圓點或長條開頭剛好落在格子上，依先後等距', () => {
    const us = band.events.map((e) => e.u / ORDINAL_STEP)
    expect(us).toEqual([0, 1, 2, 3])
    expect(band.events.map((e) => e.ev.id)).toEqual(['a', 'b', 'r', 'c'])
  })

  it('相對時間事件照先後排進格子（不需推估的比例位置）', () => {
    const r = byId.get('r')!
    expect(r.u).toBeGreaterThan(byId.get('a')!.u)
    expect(r.u).toBeLessThan(byId.get('c')!.u)
  })

  it('關鍵事件標記不受影響', () => {
    expect(byId.get('c')!.isKey).toBe(true)
  })

  it('長條的結尾落在兩格之間，仍在開頭之後', () => {
    const b = byId.get('b')!
    expect(base.warp.toU(b.tEnd)).toBeGreaterThan(b.u)
  })

  it('初始範圍涵蓋所有格子', () => {
    expect(base.initialDomain[0]).toBeLessThan(0)
    expect(base.initialDomain[1]).toBeGreaterThan(3 * ORDINAL_STEP)
  })
})
