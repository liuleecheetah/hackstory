import { describe, expect, it } from 'vitest'
import type { CalloutBounds, CalloutMetrics } from './callouts'
import { leaderLength, placeCallouts } from './callouts'

const M: CalloutMetrics = {
  boxW: 180,
  pad: 8,
  titleFont: 12,
  summaryFont: 11,
  lineHeight: 1.35,
  gap: 10,
  maxLeader: 220,
}
const B: CalloutBounds = { left: 0, top: 40, right: 960, bottom: 540 }

const spec = (key: string, anchorX: number, anchorY: number, summary = '一句摘要說明這件事為何重要') => ({
  key,
  title: `事件 ${key}`,
  summary,
  anchorX,
  anchorY,
})

function noOverlap(boxes: Array<{ x: number; y: number; w: number; h: number }>) {
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const [a, b] = [boxes[i], boxes[j]]
      const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y
      expect(apart, `${i} 與 ${j} 重疊`).toBe(true)
    }
  }
}

describe('placeCallouts：橫式', () => {
  // 6 個挨得很近的關鍵事件，最容易互相打架
  const specs = [100, 160, 220, 480, 520, 860].map((x, i) => spec(String(i), x, 290))
  const { placed, dropped } = placeCallouts(specs, B, 'horizontal', M)

  it('全部放得下，任兩框不重疊', () => {
    expect(dropped).toEqual([])
    expect(placed.length).toBe(6)
    noOverlap(placed)
  })

  it('全部在畫布範圍內', () => {
    for (const p of placed) {
      expect(p.x).toBeGreaterThanOrEqual(B.left)
      expect(p.y).toBeGreaterThanOrEqual(B.top)
      expect(p.x + p.w).toBeLessThanOrEqual(B.right)
      expect(p.y + p.h).toBeLessThanOrEqual(B.bottom)
    }
  })

  it('引線長度不超過上限', () => {
    for (const p of placed) expect(leaderLength(p, p.anchorX, p.anchorY)).toBeLessThanOrEqual(M.maxLeader)
  })

  it('上下交錯擺放', () => {
    expect(new Set(placed.map((p) => p.side))).toEqual(new Set(['above', 'below']))
  })
})

describe('placeCallouts：放不下時的退路', () => {
  it('空間不夠時先縮短摘要，最後才省略並回報', () => {
    const tight: CalloutBounds = { left: 0, top: 0, right: 400, bottom: 120 }
    const specs = Array.from({ length: 8 }, (_, i) => spec(String(i), 50 + i * 40, 60, '很長的摘要'.repeat(10)))
    const { placed, dropped } = placeCallouts(specs, tight, 'horizontal', M)
    expect(placed.length + dropped.length).toBe(8)
    expect(dropped.length).toBeGreaterThan(0)
    noOverlap(placed)
    // 被擠的框摘要變短或只剩標題
    expect(placed.some((p) => p.summaryLines.length < 2)).toBe(true)
  })
})

describe('placeCallouts：直式', () => {
  it('靠右側堆疊、不重疊、在範圍內', () => {
    const vb: CalloutBounds = { left: 0, top: 60, right: 540, bottom: 900 }
    const specs = [200, 230, 260, 500, 700].map((y, i) => spec(String(i), 90, y))
    const { placed, dropped } = placeCallouts(specs, vb, 'vertical', { ...M, maxLeader: 500 })
    expect(dropped).toEqual([])
    noOverlap(placed)
    for (const p of placed) {
      expect(p.x + p.w).toBeLessThanOrEqual(vb.right)
      expect(p.y).toBeGreaterThanOrEqual(vb.top)
      expect(p.y + p.h).toBeLessThanOrEqual(vb.bottom)
    }
  })
})

describe('placeCallouts：絕不蓋到事件文字', () => {
  it('有空位時避開事件的文字，寧可放遠一點', () => {
    // 錨點上下兩側都被事件文字佔住，只剩畫布底部有空
    const obstacles = [
      { x: 0, y: 40, w: 960, h: 240 },
      { x: 0, y: 300, w: 960, h: 140 },
    ]
    const { placed, dropped } = placeCallouts([spec('a', 480, 290)], B, 'horizontal', { ...M, maxLeader: 600 }, obstacles)
    expect(dropped).toEqual([])
    const p = placed[0]
    for (const o of obstacles) {
      const hit = p.x < o.x + o.w && o.x < p.x + p.w && p.y < o.y + o.h && o.y < p.y + p.h
      expect(hit).toBe(false)
    }
    expect(p.y).toBeGreaterThanOrEqual(440)
  })

  it('整張圖都沒有空位時省略並回報，不會硬蓋上去', () => {
    const everywhere = [{ x: 0, y: 0, w: 960, h: 540 }]
    const { placed, dropped } = placeCallouts([spec('a', 480, 290)], B, 'horizontal', M, everywhere)
    expect(placed).toEqual([])
    expect(dropped).toEqual(['a'])
  })

  it('多個標註、有事件文字時：框之間不重疊，也都不蓋到事件', () => {
    const obstacles = [100, 300, 500, 700].map((x) => ({ x, y: 250, w: 150, h: 26 }))
    const specs = [120, 320, 520, 720].map((x, i) => spec(String(i), x, 263))
    const { placed } = placeCallouts(specs, B, 'horizontal', M, obstacles)
    expect(placed.length).toBe(4)
    noOverlap(placed)
    for (const p of placed) {
      for (const o of obstacles) {
        const hit = p.x < o.x + o.w && o.x < p.x + p.w && p.y < o.y + o.h && o.y < p.y + p.h
        expect(hit).toBe(false)
      }
    }
  })
})

describe('placeCallouts：指定偏好的一側（雙向對照）', () => {
  it('prefer above：每個框都在事件的上方（框的中心高於事件），不上下交錯', () => {
    const specs = [spec('a', 200, 300), spec('b', 500, 300), spec('c', 800, 300)]
    const { placed } = placeCallouts(specs, B, 'horizontal', M, [], 'above')
    expect(placed).toHaveLength(3)
    for (const p of placed) expect(p.side).toBe('above')
    // 沒指定時上下交錯：同樣三個事件至少有一個放在下方
    const mixed = placeCallouts(specs, B, 'horizontal', M, []).placed
    expect(mixed.some((p) => p.side === 'below')).toBe(true)
  })

  it('範圍只給刻度軸下方時，框不會跑到軸的另一側', () => {
    const axisBottom = 300
    const { placed } = placeCallouts(
      [spec('a', 300, 340), spec('b', 600, 340)],
      { ...B, top: axisBottom },
      'horizontal',
      M,
      [],
      'below',
    )
    for (const p of placed) expect(p.y).toBeGreaterThanOrEqual(axisBottom)
  })
})
