// isFeatured 的測試：布林新欄位、相容舊 importance、兩者並存的優先權
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

  it('沒有 featured 也沒有 importance → 不是重點', () => {
    expect(isFeatured(ev({}))).toBe(false)
  })

  it('相容舊檔：沒有 featured、importance 為 5 → 視為重點', () => {
    expect(isFeatured(ev({ importance: 5 }))).toBe(true)
  })

  it('相容舊檔：importance 為 1–4 → 不是重點', () => {
    expect(isFeatured(ev({ importance: 3 }))).toBe(false)
  })

  it('兩者並存時以 featured 為準（featured:false 蓋過 importance:5）', () => {
    expect(isFeatured(ev({ featured: false, importance: 5 }))).toBe(false)
  })
})
