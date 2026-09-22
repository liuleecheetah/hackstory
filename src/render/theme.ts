// 主題：render 層所有字級、尺寸、顏色的唯一來源。
//
// 時間軸不再把「字 12 像素、圓點半徑 5」寫死在繪製程式裡，而是讀一組主題。
// 簡報出圖要大字、會議投影要更大、列印要高對比——都只是換一組主題，繪製程式不變。
// ui 層挑主題傳進來；render 不知道使用者在哪個模式，只知道收到什麼主題。
//
// 「螢幕」主題的每個數字都與改版前寫死的常數完全相同，所以預設畫面一模一樣。
// 之後換風格（配色）只改這個檔案。

export type ThemeId = 'screen' | 'presentation' | 'presentation-dark' | 'print'
export type Density = 'comfortable' | 'compact'

export interface ThemeColors {
  /** 畫布底色 */
  bg: string
  /** 最重要的文字（關鍵事件標題、匯出標題） */
  ink: string
  /** 一般事件標題 */
  inkEvent: string
  /** 按鈕符號等次要文字 */
  inkSoft: string
  /** 刻度數字、欄內輔助文字 */
  inkMuted: string
  /** 日期、範圍標籤等最淡的輔助文字 */
  inkFaint: string
  /** 刻度軸線、斷軸虛線、按鈕框 */
  axis: string
  /** 背景格線 */
  grid: string
  /** 光暈、空心圓點內部、淡出漸層（通常等於底色） */
  halo: string
  /** 亮起的關係線 */
  highlight: string
  /** 關係說明標籤：字、底、框 */
  warn: string
  warnBg: string
  warnLine: string
  /** 放在軸線色塊上的字：深色塊用亮字、淺色塊用暗字（依對比度自動挑） */
  onColorLight: string
  onColorDark: string
  /** 標註框的底色（淺色主題白底、深色主題深灰底） */
  calloutBg: string
}

/** 六級字（px） */
export interface ThemeFonts {
  title: number
  subtitle: number
  track: number
  event: number
  date: number
  footer: number
}

/** 一組主題：render 層所有尺寸與顏色的唯一來源 */
export interface RenderTheme {
  id: ThemeId
  /** 字級與尺寸倍率：1 = 螢幕；簡報 1.4 */
  scale: number
  density: Density
  fontFamily: string
  /** 六級字，由 scale（與 density）衍生 */
  font: ThemeFonts
  /** 幾何（px），由 scale 與 density 衍生 */
  laneH: number
  trackLabelH: number
  bandGap: number
  dotR: number
  keyDotR: number
  barH: number
  keyBarH: number
  colors: ThemeColors
  /** 圖層／軸線色盤（色盲安全） */
  palette: string[]
}

/** 倍率 1、舒適密度時的基準值——也就是改版前寫死在程式裡的數字 */
const BASE_FONT: ThemeFonts = { title: 16, subtitle: 13, track: 13, event: 12, date: 11, footer: 10 }
const BASE_GEOMETRY = { laneH: 26, trackLabelH: 26, bandGap: 12, dotR: 5, keyDotR: 7.5, barH: 12, keyBarH: 16 }

/**
 * 精簡模式相對於舒適模式的縮小比例。
 * 以改版前精簡模式手填的那組數字反推（17/26、20/26…），
 * 所以螢幕主題開精簡模式的樣子跟以前一樣；其他主題則等比例跟著縮。
 */
const COMPACT_RATIO = {
  laneH: 17 / 26,
  trackLabelH: 20 / 26,
  bandGap: 7 / 12,
  dotR: 4 / 5,
  keyDotR: 6 / 7.5,
  barH: 9 / 12,
  keyBarH: 12 / 16,
  event: 11 / 12,
}

/** Okabe–Ito 色盲安全色盤（前六色），淺底用 */
export const DEFAULT_PALETTE = ['#0072b2', '#d55e00', '#009e73', '#cc79a7', '#e69f00', '#56b4e9']
/** 深底用：同一組色相，換成在深色上看得清楚的亮色 */
const DARK_PALETTE = ['#56b4e9', '#e69f00', '#2cc79a', '#e08fbd', '#f0e442', '#ff8c4d']

const FONT_FAMILY = "'Noto Sans TC', system-ui, 'PingFang TC', sans-serif"

const LIGHT_COLORS: ThemeColors = {
  bg: '#ffffff',
  ink: '#1e293b',
  inkEvent: '#334155',
  inkSoft: '#475569',
  inkMuted: '#64748b',
  inkFaint: '#94a3b8',
  axis: '#cbd5e1',
  grid: '#e2e8f0',
  halo: '#ffffff',
  highlight: '#d97706',
  warn: '#b45309',
  warnBg: '#fffbeb',
  warnLine: '#f59e0b',
  onColorLight: '#ffffff',
  onColorDark: '#111827',
  calloutBg: '#ffffff',
}

/** 依倍率與密度算出字級與幾何 */
function sized(scale: number, density: Density): Pick<RenderTheme, 'font' | keyof typeof BASE_GEOMETRY> {
  const c = density === 'compact'
  const g = (k: keyof typeof BASE_GEOMETRY) => BASE_GEOMETRY[k] * scale * (c ? COMPACT_RATIO[k] : 1)
  const font = Object.fromEntries(
    Object.entries(BASE_FONT).map(([k, v]) => [k, v * scale]),
  ) as unknown as ThemeFonts
  if (c) font.event = BASE_FONT.event * scale * COMPACT_RATIO.event
  return {
    font,
    laneH: g('laneH'),
    trackLabelH: g('trackLabelH'),
    bandGap: g('bandGap'),
    dotR: g('dotR'),
    keyDotR: g('keyDotR'),
    barH: g('barH'),
    keyBarH: g('keyBarH'),
  }
}

function makeTheme(id: ThemeId, scale: number, colors: ThemeColors, palette: string[]): RenderTheme {
  return {
    id,
    scale,
    density: 'comfortable',
    fontFamily: FONT_FAMILY,
    ...sized(scale, 'comfortable'),
    colors,
    palette,
  }
}

export const THEMES: Record<ThemeId, RenderTheme> = {
  /** 螢幕：日常編輯，數值與改版前完全相同 */
  screen: makeTheme('screen', 1, LIGHT_COLORS, DEFAULT_PALETTE),
  /** 簡報（淺底）：字與圓點放大 1.4 倍，輔助文字加深，投影也看得清楚 */
  presentation: makeTheme(
    'presentation',
    1.4,
    { ...LIGHT_COLORS, inkEvent: '#1e293b', inkMuted: '#475569', inkFaint: '#64748b' },
    DEFAULT_PALETTE,
  ),
  /** 簡報（深底） */
  'presentation-dark': makeTheme(
    'presentation-dark',
    1.4,
    {
      bg: '#16191f',
      ink: '#f8fafc',
      inkEvent: '#e2e8f0',
      inkSoft: '#cbd5e1',
      inkMuted: '#b6c2d1',
      inkFaint: '#94a3b8',
      axis: '#475569',
      grid: '#2a313c',
      halo: '#16191f',
      highlight: '#f59e0b',
      warn: '#fcd34d',
      warnBg: '#3a2e12',
      warnLine: '#f59e0b',
      onColorLight: '#ffffff',
      onColorDark: '#111827',
      calloutBg: '#252c37',
    },
    DARK_PALETTE,
  ),
  /** 列印：略放大、文字全部加深，灰色印出來才不會糊掉 */
  print: makeTheme(
    'print',
    1.1,
    {
      ...LIGHT_COLORS,
      ink: '#000000',
      inkEvent: '#111827',
      inkSoft: '#1f2937',
      inkMuted: '#374151',
      inkFaint: '#4b5563',
      axis: '#9ca3af',
      grid: '#d1d5db',
    },
    DEFAULT_PALETTE,
  ),
}

/** 以某個主題為底，換倍率或密度（例如會議模式再放大、或開精簡模式） */
export function deriveTheme(
  base: RenderTheme,
  opts: { scale?: number; density?: Density },
): RenderTheme {
  const scale = opts.scale ?? base.scale
  const density = opts.density ?? base.density
  if (scale === base.scale && density === base.density) return base
  return { ...base, scale, density, ...sized(scale, density) }
}

// ---- 對比度（WCAG 2 公式），給測試檢查主題的文字看不看得清楚 ----

function channel(v: number): number {
  const s = v / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h
  const n = parseInt(full, 16)
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}

/** 兩個顏色的對比度（1–21）。一般文字至少要 4.5 */
export function contrastRatio(fg: string, bg: string): number {
  const a = luminance(fg)
  const b = luminance(bg)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/** 放在某個色塊上的字要用亮字還是暗字：挑對比度較高的那個 */
export function textOnColor(fill: string, colors: ThemeColors): string {
  return contrastRatio(colors.onColorLight, fill) >= contrastRatio(colors.onColorDark, fill)
    ? colors.onColorLight
    : colors.onColorDark
}
