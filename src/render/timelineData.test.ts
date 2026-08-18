// 與方向無關的資料層測試。
// 這一層決定「畫哪些事件、落在哪段時間、標題與日期文字長什麼樣、軸線什麼顏色」——
// 橫式與直式共用同一份結果，所以這裡測壞了，兩種方向會一起壞。
import { describe, expect, it } from 'vitest'
import type { HstEvent, TimelineDocument } from '../core'
import { buildBands, buildTimelineBase, buildTimelineData, PALETTE } from './timelineData'
import type { TimelineSource } from './types'

const DAY = 86_400_000

/** 一個絕對時間點（日精度） */
const day = (value: string) => ({ value, precision: 'day' as const })

function doc(over: Partial<TimelineDocument> = {}): TimelineDocument {
  return {
    hackstory: '0.4',
    id: 'test-doc',
    meta: { title: '測試時間軸' },
    tracks: [{ id: 'main', title: '主軸' }],
    events: [],
    ...over,
  }
}

function src(d: TimelineDocument, over: Partial<TimelineSource> = {}): TimelineSource {
  return { id: 'layer-1', doc: d, ...over }
}

const opts = { showDates: true, showYears: true, collapseGaps: false }

describe('buildTimelineData：事件的時間範圍', () => {
  const events: HstEvent[] = [
    { id: 'e1', track: 'main', title: '點事件', start: day('2017-05-24') },
    {
      id: 'e2',
      track: 'main',
      title: '區間事件',
      start: day('2016-11-01'),
      end: day('2016-11-30'),
    },
    { id: 'e3', track: 'main', title: '進行中', start: day('2019-01-01'), ongoing: true },
  ]
  const data = buildTimelineData([src(doc({ events }))], opts)
  const byId = new Map(data.bands[0].events.map((e) => [e.ev.id, e]))

  it('沒有結束時間的事件是圓點，時間範圍縮成精度範圍的中點', () => {
    const e = byId.get('e1')!
    expect(e.kind).toBe('dot')
    expect(e.tStart).toBe(e.tEnd)
    // 日精度：2017/5/24 一整天的中點 = 中午
    expect(new Date(e.tStart).getHours()).toBe(12)
  })

  it('有結束時間的事件是長條，從開始範圍的頭畫到結束範圍的尾', () => {
    const e = byId.get('e2')!
    expect(e.kind).toBe('bar')
    expect(new Date(e.tStart).getDate()).toBe(1)
    // 11/30 這天的「尾」＝ 12/1 零時
    expect(new Date(e.tEnd).getMonth()).toBe(11)
  })

  it('進行中的事件是長條，一路畫到今天', () => {
    const e = byId.get('e3')!
    expect(e.kind).toBe('bar')
    expect(e.ongoing).toBe(true)
    expect(Math.abs(e.tEnd - Date.now())).toBeLessThan(60_000)
  })

  it('事件依開始時間排序（直式的單欄合流靠這個順序混排）', () => {
    expect(data.bands[0].events.map((e) => e.ev.id)).toEqual(['e2', 'e1', 'e3'])
  })
})

describe('buildTimelineData：標題與日期文字', () => {
  const events: HstEvent[] = [
    {
      id: 'e1',
      track: 'main',
      title: '這是一個非常非常長的事件標題會被截斷掉尾巴',
      start: day('2017-05-24'),
    },
  ]

  it('顯示日期時，日期前綴含年份', () => {
    const d = buildTimelineData([src(doc({ events }))], opts)
    expect(d.bands[0].events[0].dateLabel).toBe('2017/5/24')
  })

  it('關掉年份時只剩月/日', () => {
    const d = buildTimelineData([src(doc({ events }))], { ...opts, showYears: false })
    expect(d.bands[0].events[0].dateLabel).toBe('5/24')
  })

  it('關掉日期時前綴為空', () => {
    const d = buildTimelineData([src(doc({ events }))], { ...opts, showDates: false })
    expect(d.bands[0].events[0].dateLabel).toBe('')
  })

  it('過長的標題會截斷並加省略號', () => {
    const d = buildTimelineData([src(doc({ events }))], opts)
    expect(d.bands[0].events[0].title).toBe('這是一個非常非常長的事件標題會被…')
  })

  it('featured 事件標記為重點（軸上放大加光暈）', () => {
    const withKey: HstEvent[] = [
      { id: 'e1', track: 'main', title: '重點', start: day('2017-05-24'), featured: true },
      { id: 'e2', track: 'main', title: '一般', start: day('2017-05-25') },
    ]
    const d = buildTimelineData([src(doc({ events: withKey }))], opts)
    expect(d.bands[0].events.map((e) => e.isKey)).toEqual([true, false])
  })
})

describe('buildTimelineData：軸線標題與配色', () => {
  const twoTracks = doc({
    tracks: [
      { id: 't1', title: '軸一', color: '#111111' },
      { id: 't2', title: '軸二', order: -1 },
    ],
    events: [],
  })

  it('多軸文件：標題標成「文件｜軸線」，並依 order 排序', () => {
    const bands = buildTimelineData([src(twoTracks, { multiTrack: true })], opts).bands
    expect(bands.map((b) => b.label)).toEqual(['測試時間軸｜軸二', '測試時間軸｜軸一'])
  })

  it('多軸文件以軸線色優先，沒指定才用圖層色', () => {
    const bands = buildTimelineData(
      [src(twoTracks, { multiTrack: true, color: '#999999' })],
      opts,
    ).bands
    expect(bands.map((b) => b.color)).toEqual(['#999999', '#111111'])
  })

  it('單軸文件：標題就是文件標題，且以圖層色優先（面板改色才會生效）', () => {
    const single = doc({ tracks: [{ id: 'main', title: '主軸', color: '#111111' }] })
    const bands = buildTimelineData([src(single, { color: '#999999' })], opts).bands
    expect(bands[0].label).toBe('測試時間軸')
    expect(bands[0].color).toBe('#999999')
  })

  it('都沒指定顏色時，依序輪用預設色盤', () => {
    const plain = doc({
      tracks: [
        { id: 't1', title: '軸一' },
        { id: 't2', title: '軸二' },
      ],
    })
    const bands = buildTimelineData([src(plain, { multiTrack: true })], opts).bands
    expect(bands.map((b) => b.color)).toEqual([PALETTE[0], PALETTE[1]])
  })
})

describe('buildTimelineData：相對時間', () => {
  const events: HstEvent[] = [
    { id: 'a', track: 'main', title: '前事件', start: day('2020-01-01') },
    { id: 'b', track: 'main', title: '後事件', start: day('2020-01-31') },
    {
      id: 'mid',
      track: 'main',
      title: '中間某時',
      start: { relative: { after: 'a', before: 'b' } },
    },
    { id: 'lost', track: 'main', title: '推不出來', start: { relative: {} } },
  ]
  const data = buildTimelineData([src(doc({ events }))], opts)
  const band = data.bands[0]

  it('推估得出來的相對事件會被畫出來，標為推估、日期寫「（推估）」', () => {
    const mid = band.events.find((e) => e.ev.id === 'mid')!
    expect(mid.estimate).toBe(true)
    expect(mid.dateLabel).toBe('（推估）')
    // 位置落在前後兩個錨點之間
    const a = band.events.find((e) => e.ev.id === 'a')!
    const b = band.events.find((e) => e.ev.id === 'b')!
    expect(mid.tStart).toBeGreaterThan(a.tStart)
    expect(mid.tStart).toBeLessThan(b.tStart)
  })

  it('相對事件帶「在Ａ之後、在Ｂ之前」的說明文字（詳情卡用）', () => {
    const mid = band.events.find((e) => e.ev.id === 'mid')!
    expect(mid.relativeNote).toBe('在「前事件」之後、在「後事件」之前')
  })

  it('推不出來的事件不畫，改在軸線標題上註記筆數（不靜默丟掉）', () => {
    expect(band.events.some((e) => e.ev.id === 'lost')).toBe(false)
    expect(band.label).toContain('1 筆相對時間無法推估')
  })

  it('隱藏軸線時仍用 fullDoc 求解，可見軸上的相對事件位置不會跑掉', () => {
    // doc 只剩 main 軸（錨點 a、b 被隱藏到另一條軸），fullDoc 保有全部事件
    const fullDoc = doc({
      tracks: [
        { id: 'main', title: '主軸' },
        { id: 'other', title: '另一軸' },
      ],
      events: events.map((e) => (e.id === 'a' || e.id === 'b' ? { ...e, track: 'other' } : e)),
    })
    const visible = doc({ events: fullDoc.events.filter((e) => e.track === 'main') })
    const d = buildTimelineData([src(visible, { fullDoc })], opts)
    const mid = d.bands[0].events.find((e) => e.ev.id === 'mid')
    expect(mid).toBeDefined()
    expect(mid!.estimate).toBe(true)
  })
})

describe('buildTimelineBase：可視範圍、空白摺疊、事件定位', () => {
  const events: HstEvent[] = [
    { id: 'e1', track: 'main', title: '早', start: day('1900-01-01') },
    { id: 'e2', track: 'main', title: '晚', start: day('2000-01-01') },
  ]

  it('沒指定 display.range 時，初始範圍涵蓋所有事件並前後留白', () => {
    const base = buildTimelineBase([src(doc({ events }))], false)
    const [u0, u1] = base.initialDomain
    expect(u0).toBeLessThan(new Date('1900-01-01').getTime())
    expect(u1).toBeGreaterThan(new Date('2000-01-02').getTime())
  })

  it('文件的 display.range 建議優先（古代年份也不會被當成 19xx）', () => {
    const d = doc({ events, display: { range: { start: '0200', end: '0300' } } })
    const base = buildTimelineBase([src(d)], false)
    expect(new Date(base.initialDomain[0]).getFullYear()).toBeLessThanOrEqual(200)
    expect(new Date(base.initialDomain[1]).getFullYear()).toBeGreaterThanOrEqual(300)
  })

  it('關閉摺疊時 warp 是直通；打開時百年空白會被壓縮', () => {
    expect(buildTimelineBase([src(doc({ events }))], false).warp.active).toBe(false)
    const collapsed = buildTimelineBase([src(doc({ events }))], true)
    expect(collapsed.warp.active).toBe(true)
    expect(collapsed.warp.gaps.length).toBe(1)
  })

  it('anchorTimes 給得出每個事件的定位時間（選取後置中用）', () => {
    const base = buildTimelineBase([src(doc({ events }))], false)
    expect(base.anchorTimes.get('layer-1/e1')).toBeDefined()
    expect(base.anchorTimes.get('layer-1/e2')).toBeDefined()
    expect(base.anchorTimes.get('layer-1/不存在')).toBeUndefined()
  })

  it('事件的 u 座標由 warp 換算：摺疊後兩個事件的距離大幅縮短', () => {
    const plain = buildTimelineData([src(doc({ events }))], opts)
    const folded = buildTimelineData([src(doc({ events }))], { ...opts, collapseGaps: true })
    const dist = (d: typeof plain) => d.bands[0].events[1].u - d.bands[0].events[0].u
    expect(dist(folded)).toBeLessThan(dist(plain) / 2)
  })

  it('切換顯示選項不必重算 base（buildBands 吃同一份 base）', () => {
    const base = buildTimelineBase([src(doc({ events }))], false)
    const withDates = buildBands([src(doc({ events }))], base, {
      showDates: true,
      showYears: true,
    })
    const withoutDates = buildBands([src(doc({ events }))], base, {
      showDates: false,
      showYears: true,
    })
    expect(withDates[0].events[0].dateLabel).not.toBe('')
    expect(withoutDates[0].events[0].dateLabel).toBe('')
    // 時間位置完全不受文字選項影響
    expect(withDates[0].events[0].tStart).toBe(withoutDates[0].events[0].tStart)
  })
})

describe('buildTimelineData：多份文件疊加', () => {
  it('每份文件的每條軸線各成一條 band，key 帶圖層 id 避免撞名', () => {
    const d1 = doc({ id: 'doc-a', meta: { title: 'Ａ' } })
    const d2 = doc({ id: 'doc-b', meta: { title: 'Ｂ' } })
    const data = buildTimelineData(
      [src(d1, { id: 'L1' }), src(d2, { id: 'L2' })],
      opts,
    )
    expect(data.bands.map((b) => b.key)).toEqual(['L1/main', 'L2/main'])
  })

  it('沒有任何圖層時不會爆掉，初始範圍以今天為中心', () => {
    const data = buildTimelineData([], opts)
    expect(data.bands).toEqual([])
    const [u0, u1] = data.initialDomain
    expect(u1 - u0).toBeCloseTo(730 * DAY, -3)
  })
})
