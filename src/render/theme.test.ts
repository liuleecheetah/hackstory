import { describe, expect, it } from 'vitest'
import { contrastRatio, deriveTheme, THEMES } from './theme'

describe('螢幕主題與改版前的數字完全相同', () => {
  it('一般密度', () => {
    const t = THEMES.screen
    expect(t.font.event).toBe(12)
    expect(t.font.track).toBe(13)
    expect(t.font.title).toBe(16)
    expect([t.laneH, t.trackLabelH, t.bandGap]).toEqual([26, 26, 12])
    expect([t.dotR, t.keyDotR, t.barH, t.keyBarH]).toEqual([5, 7.5, 12, 16])
  })

  it('精簡模式等於以前手填的那組數字', () => {
    const t = deriveTheme(THEMES.screen, { density: 'compact' })
    expect(t.laneH).toBeCloseTo(17)
    expect(t.trackLabelH).toBeCloseTo(20)
    expect(t.bandGap).toBeCloseTo(7)
    expect(t.dotR).toBeCloseTo(4)
    expect(t.keyDotR).toBeCloseTo(6)
    expect(t.barH).toBeCloseTo(9)
    expect(t.keyBarH).toBeCloseTo(12)
    expect(t.font.event).toBeCloseTo(11)
    // 精簡只縮事件列，軸線名等其他字級不變
    expect(t.font.track).toBe(13)
  })
})

describe('deriveTheme：倍率與密度', () => {
  it('倍率會等比例放大字級與尺寸', () => {
    const t = deriveTheme(THEMES.screen, { scale: 2 })
    expect(t.font.event).toBe(24)
    expect(t.laneH).toBe(52)
    expect(t.dotR).toBe(10)
    // 顏色、色盤照舊
    expect(t.colors).toBe(THEMES.screen.colors)
  })

  it('簡報主題再乘 1.2（會議模式）', () => {
    const t = deriveTheme(THEMES.presentation, { scale: THEMES.presentation.scale * 1.2 })
    expect(t.font.event).toBeCloseTo(12 * 1.4 * 1.2)
  })

  it('精簡模式在放大的主題上也照同樣比例縮', () => {
    const big = THEMES.presentation
    const t = deriveTheme(big, { density: 'compact' })
    expect(t.laneH / big.laneH).toBeCloseTo(17 / 26)
  })

  it('沒改東西就回傳原主題', () => {
    expect(deriveTheme(THEMES.print, {})).toBe(THEMES.print)
  })
})

describe('四個預設主題都看得清楚', () => {
  for (const t of Object.values(THEMES)) {
    it(`${t.id}：事件字級至少 12px`, () => {
      expect(t.font.event).toBeGreaterThanOrEqual(12)
    })

    it(`${t.id}：主要文字對背景的對比度至少 4.5`, () => {
      const { bg, ink, inkEvent, inkSoft, inkMuted } = t.colors
      for (const fg of [ink, inkEvent, inkSoft, inkMuted]) {
        expect(contrastRatio(fg, bg), `${fg} 對 ${bg}`).toBeGreaterThanOrEqual(4.5)
      }
    })

    // 螢幕主題的最淡文字（日期）沿用改版前的淺灰，刻意不在這裡要求；
    // 要投影或印出來的主題則連日期也必須看得清楚
    if (t.id !== 'screen') {
      it(`${t.id}：連日期等最淡的文字也至少 4.5`, () => {
        expect(contrastRatio(t.colors.inkFaint, t.colors.bg)).toBeGreaterThanOrEqual(4.5)
      })
    }

    it(`${t.id}：色盤最多八色`, () => {
      expect(t.palette.length).toBeGreaterThan(0)
      expect(t.palette.length).toBeLessThanOrEqual(8)
    })
  }
})

describe('contrastRatio：WCAG 公式', () => {
  it('黑對白是 21、同色是 1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21)
    expect(contrastRatio('#abc', '#aabbcc')).toBeCloseTo(1)
  })
})
