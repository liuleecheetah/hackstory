import { describe, expect, it } from 'vitest'
import type { Period, TimelineDocument } from '../core'
import { buildWarp, IDENTITY_WARP } from './gaps'
import { buildOrdinalWarp } from './ordinal'
import { layoutPeriods, periodSources } from './periods'
import type { TimelineSource } from './types'

const FILLS = ['#aaa111', '#bbb222']
const D = (y: number, m = 1, d = 1) => new Date(y, m - 1, d).getTime()

const martialLaw: Period = {
  id: 'martial-law',
  title: '戒嚴時期',
  start: { value: '1949-05-20', precision: 'day' },
  end: { value: '1987-07-15', precision: 'day' },
}
const afterLifting: Period = {
  title: '解嚴後',
  start: { value: '1987', precision: 'year' },
}

describe('layoutPeriods', () => {
  it('時期的起訖換成座標：開始取開始那天的頭，結束取結束那天的尾', () => {
    const [band] = layoutPeriods([martialLaw], IDENTITY_WARP, FILLS)
    expect(band.u0).toBe(D(1949, 5, 20))
    expect(band.u1).toBe(D(1987, 7, 16))
    expect(band.title).toBe('戒嚴時期')
    expect(band.openEnded).toBe(false)
  })

  it('沒有結束時間 = 至今，畫到 now', () => {
    const now = D(2026, 9, 23)
    const [band] = layoutPeriods([afterLifting], IDENTITY_WARP, FILLS, '', now)
    expect(band.u0).toBe(D(1987))
    expect(band.u1).toBe(now)
    expect(band.openEnded).toBe(true)
  })

  it('沒指定顏色時輪流使用主題的淡色；自訂色碼畫得淡一點；不是色碼就用自動配色', () => {
    const bands = layoutPeriods(
      [martialLaw, afterLifting, { ...martialLaw, id: 'c', color: '#e8e4dc' }, { ...martialLaw, id: 'd', color: '淡灰' }],
      IDENTITY_WARP,
      FILLS,
    )
    expect(bands.map((b) => b.fill)).toEqual(['#aaa111', '#bbb222', '#e8e4dc', '#bbb222'])
    expect(bands[2].opacity).toBeLessThan(1)
    expect(bands[0].opacity).toBe(1)
  })

  it('跟事件用同一個 warp：摺疊空白時底色帶跟著壓縮', () => {
    // 1900 與 2000 兩件事件，中間的大空白會被摺疊
    const warp = buildWarp(
      [
        [D(1900), D(1900, 2)],
        [D(2000), D(2000, 2)],
      ],
      true,
    )
    expect(warp.active).toBe(true)
    const [band] = layoutPeriods(
      [{ title: '整段', start: { value: '1900', precision: 'year' }, end: { value: '2000', precision: 'year' } }],
      warp,
      FILLS,
    )
    // 壓縮後的長度遠小於真實的一百年
    expect(band.u1 - band.u0).toBeLessThan(D(2001) - D(1900))
    expect(band.u0).toBe(warp.toU(D(1900)))
  })

  it('順序等距時也正確：底色帶的頭尾落在對應的格子之間', () => {
    const warp = buildOrdinalWarp([D(1947), D(1950), D(1979), D(1987, 7, 16), D(1996)])
    const [band] = layoutPeriods([martialLaw], warp, FILLS)
    expect(band.u0).toBeGreaterThan(warp.toU(D(1947)))
    expect(band.u0).toBeLessThan(warp.toU(D(1950)))
    expect(band.u1).toBe(warp.toU(D(1987, 7, 16)))
  })

  it('沒有時期時回傳空陣列', () => {
    expect(layoutPeriods(undefined, IDENTITY_WARP, FILLS)).toEqual([])
  })
})

describe('periodSources', () => {
  const doc = (id: string, periods?: Period[]): TimelineDocument => ({
    hackstory: '0.5',
    id,
    meta: { title: id },
    tracks: [{ id: 't', title: 't' }],
    events: [],
    periods,
  })
  const src = (id: string, periods?: Period[]): TimelineSource => ({ id, doc: doc(id, periods) })

  it('圖層順序裡第一份有時期的畫成滿版底色，其餘畫細條', () => {
    const { primary, others } = periodSources([src('a'), src('b', [martialLaw]), src('c', [afterLifting])])
    expect(primary?.id).toBe('b')
    expect(others.map((s) => s.id)).toEqual(['c'])
  })

  it('都沒有時期時沒有底色', () => {
    expect(periodSources([src('a')]).primary).toBeNull()
  })
})
