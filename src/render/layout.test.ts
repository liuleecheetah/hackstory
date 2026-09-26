import { describe, expect, it } from 'vitest'
import { estimateTextWidth, wrapLines } from './layout'

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
