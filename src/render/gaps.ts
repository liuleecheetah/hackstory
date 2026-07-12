// render 層：空白摺疊（SPEC display.collapseGaps）
// 把整條軸上沒有事件的大段空白壓縮，讓事件密集區獲得更多畫面空間。
//
// 作法：建立「真實時間 t ↔ 壓縮座標 u」的分段線性對應。
// 事件密集區斜率為 1（u 與 t 一致，縮放平移的手感不變），
// 大段空白以固定長度壓縮。對應嚴格遞增、可雙向換算，
// 所以以游標為錨點的縮放在摺疊模式下依然正確。

export interface CollapsedGap {
  /** 空白的真實起訖時間（毫秒） */
  tStart: number
  tEnd: number
  /** 壓縮座標上的中心位置（畫斷軸記號用） */
  uCenter: number
  /** 被略過的實際時間長度（毫秒） */
  skippedMs: number
}

export interface TimeWarp {
  toU(t: number): number
  toT(u: number): number
  gaps: CollapsedGap[]
  /** 是否真的有壓縮（找不到大空白時等同直通） */
  active: boolean
}

/** 直通對應：不摺疊 */
export const IDENTITY_WARP: TimeWarp = {
  toU: (t) => t,
  toT: (u) => u,
  gaps: [],
  active: false,
}

/** 空白要大於整體範圍的這個比例才摺疊 */
const GAP_MIN_RATIO = 0.1
/** 每段摺疊後的空白，佔整體範圍的比例 */
const GAP_COMPRESSED_RATIO = 0.03
/** 每個事件範圍前後保留的呼吸空間比例（事件不會貼著斷軸記號） */
const PAD_RATIO = 0.02

interface InternalGap {
  tStart: number
  tEnd: number
  uLen: number
}

/**
 * 從所有事件的時間範圍建立摺疊對應。
 * spans：每個事件佔用的 [開始, 結束]（毫秒）。enabled 為 false 時直通。
 */
export function buildWarp(spans: Array<[number, number]>, enabled: boolean): TimeWarp {
  if (!enabled || spans.length === 0) return IDENTITY_WARP

  // 1. 合併重疊的事件範圍
  const sorted = [...spans].sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const [s, e] of sorted) {
    const last = merged[merged.length - 1]
    if (last && s <= last[1]) {
      last[1] = Math.max(last[1], e)
    } else {
      merged.push([s, e])
    }
  }

  const total = merged[merged.length - 1][1] - merged[0][0]
  if (total <= 0) return IDENTITY_WARP

  // 2. 前後加呼吸空間，再合併一次
  const pad = total * PAD_RATIO
  const padded: Array<[number, number]> = []
  for (const [s, e] of merged) {
    const ps = s - pad
    const pe = e + pad
    const last = padded[padded.length - 1]
    if (last && ps <= last[1]) {
      last[1] = Math.max(last[1], pe)
    } else {
      padded.push([ps, pe])
    }
  }

  // 3. 找出要摺疊的大空白
  const minGap = total * GAP_MIN_RATIO
  const compressedLen = total * GAP_COMPRESSED_RATIO
  const internal: InternalGap[] = []
  for (let i = 0; i < padded.length - 1; i++) {
    const gapStart = padded[i][1]
    const gapEnd = padded[i + 1][0]
    if (gapEnd - gapStart > minGap) {
      internal.push({ tStart: gapStart, tEnd: gapEnd, uLen: compressedLen })
    }
  }
  if (internal.length === 0) return IDENTITY_WARP

  // 4. 雙向換算（internal 已依時間排序）
  const toU = (t: number): number => {
    let offset = 0 // u 相對 t 的累積位移（空白壓縮造成）
    for (const g of internal) {
      if (t <= g.tStart) break
      if (t < g.tEnd) {
        // 落在空白內：線性內插
        return g.tStart + offset + ((t - g.tStart) / (g.tEnd - g.tStart)) * g.uLen
      }
      offset += g.uLen - (g.tEnd - g.tStart)
    }
    return t + offset
  }

  const toT = (u: number): number => {
    let offset = 0
    for (const g of internal) {
      const uStart = g.tStart + offset
      if (u <= uStart) break
      const uEnd = uStart + g.uLen
      if (u < uEnd) {
        return g.tStart + ((u - uStart) / g.uLen) * (g.tEnd - g.tStart)
      }
      offset += g.uLen - (g.tEnd - g.tStart)
    }
    return u - offset
  }

  const gaps: CollapsedGap[] = internal.map((g) => ({
    tStart: g.tStart,
    tEnd: g.tEnd,
    uCenter: toU(g.tStart) + g.uLen / 2,
    skippedMs: g.tEnd - g.tStart,
  }))

  return { toU, toT, gaps, active: true }
}

const DAY = 86_400_000

/** 斷軸記號旁的「略過多久」文字 */
export function formatSkipped(ms: number): string {
  const years = ms / (365.25 * DAY)
  if (years >= 1.5) return `${Math.round(years)} 年`
  const months = ms / (30.44 * DAY)
  if (months >= 1.5) return `${Math.round(months)} 個月`
  return `${Math.round(ms / DAY)} 天`
}
