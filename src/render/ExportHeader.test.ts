import { describe, expect, it } from 'vitest'
import { layoutExportHeader } from './ExportHeader'
import { THEMES } from './theme'

const T = THEMES.screen

describe('layoutExportHeader：標題列', () => {
  it('短標題：一行，高度與以前相同（無副標 42、有副標 64）', () => {
    expect(layoutExportHeader('台灣婚姻平權進程', undefined, 960, T)).toMatchObject({
      titleLines: ['台灣婚姻平權進程'],
      height: 42,
      titleTruncated: false,
    })
    expect(layoutExportHeader('標題', '副標', 960, T).height).toBe(64)
  })

  it('太長的標題換成兩行，標題列跟著加高，不截斷', () => {
    const long = '從祁家威到釋字748：台灣婚姻平權走了三十三年的漫長道路與關鍵轉折'
    const h = layoutExportHeader(long, '副標', 400, T)
    expect(h.titleLines.length).toBe(2)
    expect(h.titleLines.join('')).toBe(long)
    expect(h.titleTruncated).toBe(false)
    expect(h.height).toBeGreaterThan(64)
  })

  it('兩行都放不下才截短，並回報 truncated 讓工作室提醒', () => {
    const tooLong = '很長的標題'.repeat(30)
    const h = layoutExportHeader(tooLong, undefined, 540, T)
    expect(h.titleLines.length).toBe(2)
    expect(h.titleLines[1].endsWith('…')).toBe(true)
    expect(h.titleTruncated).toBe(true)
  })

  it('右上角要讓位（非等比標示）時，標題可用寬度變窄', () => {
    const t = '台灣婚姻平權進程：從街頭到國會'
    const wide = layoutExportHeader(t, undefined, 400, T)
    const narrow = layoutExportHeader(t, undefined, 400, T, 200)
    expect(narrow.titleLines.length).toBeGreaterThanOrEqual(wide.titleLines.length)
  })
})
