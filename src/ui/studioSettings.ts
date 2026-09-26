// ui 層：出圖工作室的設定記憶
//
// 試用員回報：關掉工作室再打開、或重新整理頁面，排好的標題、範圍、標註全部重來，
// 主編要改一個字就得整張重做。所以把工作室的設定存在這個瀏覽器（localStorage）。
//
// 這只是「方便」，不是資料：存不進去（私密視窗、空間滿了）就算了，工作室照常用預設值。
// 圖層在每次載入時會拿到新的執行期 id（layer-3-xxx），所以存的時候改用「文件 id」指認，
// 讀回來時再對到目前的圖層。

import type { Layer } from '../compose/useLayers'

const STORE_KEY = 'hackstory-studio-v1'

/** 存起來的設定（圖層、軸線、標註都用「文件 id/…」指認） */
export interface StoredStudioSettings {
  v: 1
  layout: string
  bDir: 'h' | 'v'
  ratioId: string
  themeId: string
  fontScale: number
  overflowMode: 'shrink' | 'split'
  /** 使用者自己打的標題／副標／出處；null = 沒改過，跟著資料自動帶入 */
  title: string | null
  subtitle: string | null
  footer: string | null
  layerDocs: string[]
  trackOffDocs: string[]
  rangeKind: string
  fromYear: string
  toYear: string
  dateYear: boolean
  dateMonth: boolean
  dateDay: boolean
  showRelations: boolean
  collapseGaps: boolean
  ordinal: boolean
  compact: boolean
  reversed: boolean
  centerAxis: boolean
  embedFontsInSvg: boolean
  cardMode: boolean
  showConfidence: boolean
  showSources: boolean
  callouts: string[]
  calloutText: Record<string, string>
  eventScope: 'all' | 'featured'
  showScopeNote: boolean
}

/** 讀回上次的設定；沒有、讀不到或格式不對都回傳 null（用預設值） */
export function loadStudioSettings(): StoredStudioSettings | null {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredStudioSettings>
    return parsed && parsed.v === 1 ? (parsed as StoredStudioSettings) : null
  } catch {
    return null
  }
}

export function saveStudioSettings(s: StoredStudioSettings): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s))
  } catch {
    // 存不進去（私密視窗、空間滿了）：不影響使用，下次打開用預設值
  }
}

export function clearStudioSettings(): void {
  try {
    localStorage.removeItem(STORE_KEY)
  } catch {
    // 同上
  }
}

/** 「圖層 id/軸線或事件 id」→「文件 id/…」（存檔用）；找不到圖層就丟掉 */
export function toDocKey(key: string, layers: Layer[]): string | null {
  const layer = layers.find((l) => key.startsWith(`${l.id}/`))
  return layer ? `${layer.doc.id}/${key.slice(layer.id.length + 1)}` : null
}

/** 「文件 id/…」→「圖層 id/…」（讀回用）：對到第一個載入該文件的圖層；沒載入就丟掉 */
export function toLayerKey(docKey: string, layers: Layer[]): string | null {
  const slash = docKey.indexOf('/')
  if (slash < 0) return null
  const layer = layers.find((l) => l.doc.id === docKey.slice(0, slash))
  return layer ? `${layer.id}/${docKey.slice(slash + 1)}` : null
}

/** 圖層 id 的集合 → 文件 id 清單 */
export function layerIdsToDocs(ids: Iterable<string>, layers: Layer[]): string[] {
  const set = new Set(ids)
  return layers.filter((l) => set.has(l.id)).map((l) => l.doc.id)
}

/** 文件 id 清單 → 目前的圖層 id（同一份文件載入兩次時都算） */
export function docsToLayerIds(docs: string[], layers: Layer[]): string[] {
  const set = new Set(docs)
  return layers.filter((l) => set.has(l.doc.id)).map((l) => l.id)
}
