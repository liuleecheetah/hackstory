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
