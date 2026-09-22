import { describe, expect, it } from 'vitest'
import type { AbsoluteTimePoint } from '../core'
import { formatPointParts } from './timeScale'

const day: AbsoluteTimePoint = { value: '2019-05-24', precision: 'day' }
const month: AbsoluteTimePoint = { value: '1987-07', precision: 'month' }
const year: AbsoluteTimePoint = { value: '1949', precision: 'year' }
const all = { year: true, month: true, day: true }

describe('formatPointParts：年、月、日分別勾選', () => {
  it('日精度的各種組合', () => {
    expect(formatPointParts(day, all)).toBe('2019/5/24')
    expect(formatPointParts(day, { year: false, month: true, day: true })).toBe('5/24')
    expect(formatPointParts(day, { year: true, month: true, day: false })).toBe('2019/5')
    expect(formatPointParts(day, { year: true, month: false, day: false })).toBe('2019')
    expect(formatPointParts(day, { year: false, month: true, day: false })).toBe('5月')
    expect(formatPointParts(day, { year: false, month: false, day: true })).toBe('24日')
    expect(formatPointParts(day, { year: false, month: false, day: false })).toBe('')
  })

  it('依精度誠實呈現：只知道到月、到年的事件不會冒出更細的部分', () => {
    expect(formatPointParts(month, all)).toBe('1987/7')
    expect(formatPointParts(month, { year: false, month: true, day: true })).toBe('7月')
    expect(formatPointParts(year, all)).toBe('1949')
    expect(formatPointParts(year, { year: false, month: true, day: true })).toBe('')
  })

  it('年代與分鐘精度', () => {
    expect(formatPointParts({ value: '1980', precision: 'decade' }, all)).toBe('1980年代')
    expect(formatPointParts({ value: '2017-05-24T09:00', precision: 'minute' }, all)).toBe('2017/5/24 09:00')
  })
})
