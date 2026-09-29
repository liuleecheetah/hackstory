// ui 層：出圖的比例清單（出圖工作室使用）

/**
 * 圖片比例。w/h 是邏輯尺寸，PNG 依選的倍率放大輸出
 * （2 倍：9:16 → 1080×1920、16:9 → 1920×1080）。
 *
 * dir 是這個比例適合的方向：長比例適合直式（時間由上往下），寬比例適合橫式。
 * 工作室選比例時會依此建議版型，使用者可以改。
 *
 * social：社群圖，主要在手機上看（畫布約縮成 375 寬顯示）。這類比例不自動縮小文字，
 * 放不下就請使用者只放關鍵事件或切成多張，免得字在手機上小到看不清楚。
 */
export const RATIO_PRESETS = [
  { id: '9-16', dir: 'v', label: '9:16', hint: '手機全螢幕／限時動態', w: 540, h: 960, social: true },
  { id: '4-5', dir: 'v', label: '4:5', hint: '社群貼文（直式）', w: 540, h: 675, social: true },
  { id: '3-4', dir: 'v', label: '3:4', hint: '一般直式', w: 540, h: 720, social: false },
  { id: '1-1', dir: 'v', label: '1:1', hint: '方形', w: 540, h: 540, social: true },
  { id: 'a4', dir: 'v', label: 'A4', hint: '直式列印', w: 620, h: 877, social: false },
  { id: '16-9', dir: 'h', label: '16:9', hint: '簡報／YouTube', w: 960, h: 540, social: false },
  { id: 'og', dir: 'h', label: '1.91:1', hint: '臉書／分享預覽圖', w: 600, h: 315, social: true },
  { id: '2-1', dir: 'h', label: '2:1', hint: 'X（Twitter）', w: 600, h: 300, social: true },
  { id: '4-3', dir: 'h', label: '4:3', hint: '傳統簡報', w: 800, h: 600, social: false },
  { id: 'a4-land', dir: 'h', label: 'A4', hint: '橫式列印', w: 877, h: 620, social: false },
] as const

export type RatioPreset = (typeof RATIO_PRESETS)[number]
export type RatioId = RatioPreset['id']

/** 手機上社群圖大約顯示成多寬（CSS px），拿來估算字在手機上多大 */
export const PHONE_VIEW_W = 375
/** 事件字在手機上至少要這麼大（px）才看得清楚 */
export const MIN_PHONE_EVENT_PX = 10
