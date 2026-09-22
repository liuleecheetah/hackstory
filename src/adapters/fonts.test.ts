import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  missingGlyphNote,
  parseFontCss,
  parseUnicodeRange,
  requiredSlices,
  uncoveredChars,
} from './fonts'

// 直接拿網站上真正的自架字型 CSS 來測，而不是自己編一份
const CSS = readFileSync(new URL('../../public/fonts/noto-sans-tc/noto-sans-tc.css', import.meta.url), 'utf8')
const BASE = 'https://example.org/hackstory/fonts/noto-sans-tc/noto-sans-tc.css'
const slices = parseFontCss(CSS, BASE)

describe('parseUnicodeRange：unicode-range 字串解析', () => {
  it('單一碼位、範圍、多段混寫', () => {
    expect(parseUnicodeRange('U+20024, U+4e00-9fff,U+ff01')).toEqual([
      [0x20024, 0x20024],
      [0x4e00, 0x9fff],
      [0xff01, 0xff01],
    ])
  })

  it('萬用字元 U+4?? 代表 U+400 到 U+4FF', () => {
    expect(parseUnicodeRange('U+4??')).toEqual([[0x400, 0x4ff]])
  })
})

describe('parseFontCss：讀自架的思源黑體 CSS', () => {
  it('每個 @font-face 都變成一個切片，Regular 與 Bold 都有', () => {
    const blocks = CSS.match(/@font-face/g)?.length ?? 0
    expect(slices.length).toBe(blocks)
    expect(new Set(slices.map((s) => s.weight))).toEqual(new Set(['400', '700']))
    expect(slices.every((s) => s.family === 'Noto Sans TC')).toBe(true)
  })

  it('相對路徑換算成完整網址', () => {
    expect(slices[0].url).toMatch(/^https:\/\/example\.org\/hackstory\/fonts\/noto-sans-tc\/slice-\d+\.woff2$/)
  })
})

describe('requiredSlices：只挑需要的切片', () => {
  it('只有英數：只需要拉丁字母的少數幾片（Regular、Bold 都有）', () => {
    const got = requiredSlices('HackStory 2017', slices)
    expect(got.length).toBeGreaterThan(0)
    expect(got.length).toBeLessThanOrEqual(4)
    expect(uncoveredChars('HackStory 2017', got)).toEqual([])
    expect(new Set(got.map((s) => s.weight))).toEqual(new Set(['400', '700']))
  })

  it('含常用中文：挑出的切片涵蓋每一個字，而且遠少於全部', () => {
    const text = '同婚立法 2019/5/24 大法官釋字第七四八號'
    const got = requiredSlices(text, slices)
    expect(got.length).toBeGreaterThan(2)
    expect(got.length).toBeLessThan(slices.length / 3)
    expect(uncoveredChars(text, got)).toEqual([])
  })

  it('空白不算字，不會多拉切片', () => {
    expect(requiredSlices('   \n\t', slices)).toEqual([])
  })
})

describe('uncoveredChars：沒有字型的字要誠實列出', () => {
  it('常用中文全都有', () => {
    expect(uncoveredChars('二二八事件 國民政府', slices)).toEqual([])
  })

  it('罕見字（擴充 B 區的𠀋）列出來，而且不重複', () => {
    expect(uncoveredChars('𠀋𠀋與常用字', slices)).toEqual(['𠀋'])
  })
})

describe('missingGlyphNote：替代字型的提醒文字', () => {
  it('沒有缺字就不提醒', () => {
    expect(missingGlyphNote([])).toBe('')
  })

  it('列出缺的字，超過五個以刪節號帶過', () => {
    expect(missingGlyphNote(['𠀋'])).toBe('有 1 個字不在思源黑體裡，會用替代字型（𠀋）')
    expect(missingGlyphNote(['a', 'b', 'c', 'd', 'e', 'f'])).toContain('（a、b、c、d、e…）')
  })
})
