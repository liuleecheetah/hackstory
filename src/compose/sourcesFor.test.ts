import { describe, expect, it } from 'vitest'
import type { TimelineDocument } from '../core'
import type { Layer } from './useLayers'
import { sourcesFor } from './useLayers'

const doc = (id: string, trackIds: string[]): TimelineDocument => ({
  hackstory: '0.4',
  id,
  meta: { title: id },
  tracks: trackIds.map((t) => ({ id: t, title: t })),
  events: trackIds.map((t, i) => ({
    id: `e${i}`,
    track: t,
    title: `事件${i}`,
    start: { value: `20${10 + i}`, precision: 'year' },
  })),
})

const layers: Layer[] = [
  { id: 'L1', doc: doc('a', ['x', 'y']), color: '#000', visible: true },
  { id: 'L2', doc: doc('b', ['z']), color: '#111', visible: false },
]

describe('sourcesFor：圖層 → 要畫的資料', () => {
  it('只留下「要畫」的圖層', () => {
    expect(sourcesFor(layers, (l) => l.visible, new Set()).map((s) => s.id)).toEqual(['L1'])
    // 出圖工作室用自己的勾選，不看圖層在畫面上是否顯示
    expect(sourcesFor(layers, () => true, new Set()).map((s) => s.id)).toEqual(['L1', 'L2'])
  })

  it('沒有隱藏軸線時原樣傳下去（物件不變，避免不必要的重算）', () => {
    const [s] = sourcesFor(layers, (l) => l.id === 'L1', new Set())
    expect(s.doc).toBe(layers[0].doc)
    expect(s.fullDoc).toBeUndefined()
  })

  it('隱藏的軸線連同事件一起拿掉，但保留完整文件給相對時間求解', () => {
    const [s] = sourcesFor(layers, (l) => l.id === 'L1', new Set(['L1/x']))
    expect(s.doc.tracks.map((t) => t.id)).toEqual(['y'])
    expect(s.doc.events.every((e) => e.track === 'y')).toBe(true)
    expect(s.fullDoc).toBe(layers[0].doc)
    // 本來是多軸文件：隱藏到剩一條仍保留多軸的標題與配色規則
    expect(s.multiTrack).toBe(true)
  })

  it('一份文件的軸線全被隱藏 → 這個圖層不畫', () => {
    expect(sourcesFor(layers, () => true, new Set(['L2/z'])).map((s) => s.id)).toEqual(['L1'])
  })
})
