// isFeatured 的測試：featured 是布林——有標記才是重點，沒標記就不是
import { describe, expect, it } from 'vitest'
import type { HstEvent } from './types'
import { isFeatured } from './events'

function ev(extra: Partial<HstEvent>): HstEvent {
  return {
    id: 'x',
    track: 'main',
    title: '測試事件',
    start: { value: '2017-05-24', precision: 'day' },
    ...extra,
  }
}

describe('isFeatured', () => {
  it('featured: true → 是重點', () => {
    expect(isFeatured(ev({ featured: true }))).toBe(true)
  })

  it('featured: false → 不是重點', () => {
    expect(isFeatured(ev({ featured: false }))).toBe(false)
  })

  it('沒有 featured → 不是重點', () => {
    expect(isFeatured(ev({}))).toBe(false)
  })
})
