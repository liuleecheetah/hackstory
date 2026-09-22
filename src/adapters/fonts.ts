// adapters 層：把思源黑體嵌進匯出的 SVG
//
// 為什麼需要：PNG 是把 SVG 當成一張「圖片」載入再畫到 canvas 上。
// 這種圖片看不到網頁載入的字型，也不准去網路上抓字型檔，
// 只認得直接寫在 SVG 裡面的字型（data: 網址）。不嵌進去，PNG 上的中文就會變成系統字。
//
// 做法：自架的字型 CSS 把思源黑體切成約一百片，每片涵蓋一段字元範圍（unicode-range）。
// 掃描圖上實際出現的字，只挑需要的那幾片、轉成 base64 塞進 SVG——不必整套字型都放進去。

import { serializeSvg, svgToPngBlob } from './export'

/** 字型的一個切片：粗細、檔案網址、涵蓋的字元範圍 */
export interface FontSlice {
  family: string
  weight: string
  style: string
  /** 切片檔的完整網址 */
  url: string
  /** 涵蓋的字元範圍（含頭尾的碼位） */
  ranges: Array<[number, number]>
  /** 原始的 unicode-range 字串，嵌入時原樣寫回 */
  rangeText: string
}

/** 自架字型 CSS 的位置（相對於網站根目錄） */
export const FONT_CSS_PATH = 'fonts/noto-sans-tc/noto-sans-tc.css'

/**
 * 解析 unicode-range 字串。
 * 支援三種寫法：單一碼位 U+4E00、範圍 U+4E00-9FFF、萬用字元 U+4??（= U+400-4FF）
 */
export function parseUnicodeRange(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (const raw of text.split(',')) {
    const part = raw.trim().replace(/^U\+/i, '')
    if (!part) continue
    if (part.includes('?')) {
      out.push([parseInt(part.replace(/\?/g, '0'), 16), parseInt(part.replace(/\?/g, 'F'), 16)])
    } else if (part.includes('-')) {
      const [a, b] = part.split('-')
      out.push([parseInt(a, 16), parseInt(b, 16)])
    } else {
      const n = parseInt(part, 16)
      out.push([n, n])
    }
  }
  return out.filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b))
}

/** 解析字型 CSS 文字，得到每個切片。相對網址以 baseUrl（CSS 檔本身的網址）為準 */
export function parseFontCss(css: string, baseUrl: string): FontSlice[] {
  const slices: FontSlice[] = []
  for (const block of css.match(/@font-face\s*{[^}]*}/g) ?? []) {
    const prop = (name: string) =>
      block.match(new RegExp(`${name}\\s*:\\s*([^;]+);`))?.[1].trim() ?? ''
    const src = block.match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/)?.[1]
    const rangeText = prop('unicode-range')
    if (!src || !rangeText) continue
    slices.push({
      family: prop('font-family').replace(/['"]/g, ''),
      weight: prop('font-weight') || '400',
      style: prop('font-style') || 'normal',
      url: new URL(src, baseUrl).href,
      ranges: parseUnicodeRange(rangeText),
      rangeText,
    })
  }
  return slices
}

function covers(slice: FontSlice, cp: number): boolean {
  return slice.ranges.some(([a, b]) => cp >= a && cp <= b)
}

/** 文字裡所有「需要字型」的字（去掉空白與重複），以碼位表示 */
function codePointsOf(text: string): number[] {
  const set = new Set<number>()
  for (const ch of text) {
    if (/\s/.test(ch)) continue
    set.add(ch.codePointAt(0)!)
  }
  return [...set]
}

/** 掃描文字，找出需要哪些切片（每種粗細各自挑，粗體字也要有粗體的切片） */
export function requiredSlices(text: string, slices: FontSlice[]): FontSlice[] {
  const cps = codePointsOf(text)
  return slices.filter((s) => cps.some((cp) => covers(s, cp)))
}

/** 任何切片都沒涵蓋的字——這些字在圖上會改用替代字型，要老實告訴使用者 */
export function uncoveredChars(text: string, slices: FontSlice[]): string[] {
  return codePointsOf(text)
    .filter((cp) => !slices.some((s) => covers(s, cp)))
    .map((cp) => String.fromCodePoint(cp))
}

let manifestCache: Promise<FontSlice[]> | null = null

/** 讀入自架的字型 CSS，得到切片清單（同一次開網頁只讀一次） */
export function loadFontManifest(cssUrl = new URL(FONT_CSS_PATH, document.baseURI).href): Promise<FontSlice[]> {
  if (!manifestCache) {
    manifestCache = fetch(cssUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`讀不到字型設定檔（${res.status}）`)
        return res.text()
      })
      .then((css) => parseFontCss(css, cssUrl))
      .catch((e) => {
        manifestCache = null // 失敗了下次再試
        throw e
      })
  }
  return manifestCache
}

/** 把一個檔案抓下來轉成 data: 網址 */
async function toDataUrl(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`讀不到字型檔（${res.status}）`)
  const blob = new Blob([await res.arrayBuffer()], { type: 'font/woff2' })
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('字型檔轉換失敗'))
    reader.readAsDataURL(blob)
  })
}

/** 把需要的切片抓成 base64，組成 @font-face 樣式字串 */
export async function buildEmbeddedFontCss(slices: FontSlice[]): Promise<string> {
  // 同一個檔案可能同時服務好幾種粗細，只抓一次
  const dataByUrl = new Map<string, Promise<string>>()
  for (const s of slices) if (!dataByUrl.has(s.url)) dataByUrl.set(s.url, toDataUrl(s.url))
  const rules = await Promise.all(
    slices.map(
      async (s) =>
        `@font-face{font-family:'${s.family}';font-style:${s.style};font-weight:${s.weight};` +
        `src:url(${await dataByUrl.get(s.url)!}) format('woff2');unicode-range:${s.rangeText};}`,
    ),
  )
  return rules.join('\n')
}

/**
 * 一步到位：給圖上的所有文字，回傳要嵌進 SVG 的字型樣式，以及會用替代字型的字。
 */
export async function embeddedFontCssForText(
  text: string,
): Promise<{ css: string; missing: string[] }> {
  const slices = await loadFontManifest()
  return {
    css: await buildEmbeddedFontCss(requiredSlices(text, slices)),
    missing: uncoveredChars(text, slices),
  }
}

/**
 * SVG 元素 → 嵌好思源黑體的 PNG。
 * missing：不在思源黑體裡、會用替代字型的字（呼叫端要告訴使用者，不靜默換字）
 */
export async function svgToPngWithFonts(
  svg: SVGSVGElement,
  width: number,
  height: number,
  opts: { scale?: number; background?: string } = {},
): Promise<{ blob: Blob; missing: string[] }> {
  const { css, missing } = await embeddedFontCssForText(svg.textContent ?? '')
  const text = serializeSvg(svg, { embeddedFontCss: css, background: opts.background })
  return { blob: await svgToPngBlob(text, width, height, opts.scale ?? 2), missing }
}

/** 「有 N 個字會用替代字型」的提醒文字；沒有就回傳空字串 */
export function missingGlyphNote(missing: string[]): string {
  if (missing.length === 0) return ''
  const shown = missing.slice(0, 5).join('、') + (missing.length > 5 ? '…' : '')
  return `有 ${missing.length} 個字不在思源黑體裡，會用替代字型（${shown}）`
}
