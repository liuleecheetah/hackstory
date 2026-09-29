import { describe, expect, it } from 'vitest'
import { assignLanesByTime, estimateTextWidth, wrapLines } from './layout'

describe('wrapLines：把文字折進固定寬度', () => {
  it('放得下就是一行', () => {
    expect(wrapLines('立法進程', 100, 12, 3)).toEqual(['立法進程'])
  })

  it('中文依寬度折行，每行都不超寬', () => {
    const lines = wrapLines('國民政府與軍事行動', 40, 12, 5)
    expect(lines.join('')).toBe('國民政府與軍事行動')
    expect(lines.every((l) => estimateTextWidth(l, 12) <= 40)).toBe(true)
    expect(lines.length).toBe(3)
  })

  it('超過行數上限時，最後一行以刪節號收尾且不超寬', () => {
    const lines = wrapLines('台灣菁英受難與地方抗爭及民間自治', 40, 12, 2)
    expect(lines.length).toBe(2)
    expect(lines[1].endsWith('…')).toBe(true)
    expect(estimateTextWidth(lines[1], 12)).toBeLessThanOrEqual(40)
  })
})

describe('wrapLines：排版細節', () => {
  it('英文單字不在中間斷開', () => {
    const lines = wrapLines('跨國同婚 Ryan × Righteous 訴訟勝訴', 90, 12, 5)
    expect(lines.some((l) => l.includes('Righteous'))).toBe(true)
    expect(lines.every((l) => estimateTextWidth(l, 12) <= 90)).toBe(true)
  })

  it('行首不出現「，」「」」這類標點，且每行都不超寬', () => {
    // 寬度剛好放得下六個字，第七個字是右括號
    const lines = wrapLines('一二三四五六」音樂會在立法院外', 72, 12, 5)
    expect(lines.every((l) => !/^[，。、」）]/.test(l))).toBe(true)
    expect(lines.every((l) => estimateTextWidth(l, 12) <= 72)).toBe(true)
    expect(lines.join('')).toBe('一二三四五六」音樂會在立法院外')
  })

  it('比一行還長的網址只好逐字拆開', () => {
    const lines = wrapLines('https://example.org/very/long/path/that/never/ends', 60, 12, 10)
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.every((l) => estimateTextWidth(l, 12) <= 60)).toBe(true)
  })
})

describe('assignLanesByTime：疊在一起的事件，早的在上', () => {
  it('不重疊的事件都在第 0 列', () => {
    const lanes = assignLanesByTime([
      { left: 0, right: 50, t: 1 },
      { left: 100, right: 150, t: 2 },
    ])
    expect(lanes).toEqual([0, 0])
  })

  it('較晚的事件不會塞回較早事件上方的空位', () => {
    // A 佔 0–100、B（較晚）佔 50–300 與 A 重疊 → B 在第 1 列；
    // C（最晚）佔 120–200，第 0 列其實空著，但它跟 B 重疊，所以要排在 B 下面
    const lanes = assignLanesByTime([
      { left: 0, right: 100, t: 1 },
      { left: 50, right: 300, t: 2 },
      { left: 120, right: 200, t: 3 },
    ])
    expect(lanes).toEqual([0, 1, 2])
  })

  it('依時間排，不是依傳入順序或左邊位置（標題翻到左側的事件也一樣）', () => {
    // 較早的事件標題翻到左側，佔的範圍在較晚事件的左邊，但它仍要在上面
    const lanes = assignLanesByTime([
      { left: 100, right: 200, t: 5 },
      { left: 40, right: 110, t: 1 },
    ])
    expect(lanes).toEqual([1, 0])
  })

  it('任兩件左右重疊的事件：較早的列號一定比較小', () => {
    const items = [
      { left: 0, right: 80, t: 1 },
      { left: 30, right: 60, t: 2 },
      { left: 70, right: 160, t: 3 },
      { left: 200, right: 260, t: 4 },
      { left: 150, right: 230, t: 5 },
    ]
    const lanes = assignLanesByTime(items, 0)
    for (let i = 0; i < items.length; i++) {
      for (let j = 0; j < items.length; j++) {
        const a = items[i]
        const b = items[j]
        if (a.t < b.t && a.left < b.right && b.left < a.right) expect(lanes[i]).toBeLessThan(lanes[j])
      }
    }
  })
})
