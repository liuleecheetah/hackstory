// render 層：標註框的排版（純函式，沒有畫面、沒有 React）
//
// 出圖工作室可以挑幾個關鍵事件，在圖上加「標題＋一句摘要」的說明框，用引線連回事件。
// 這裡只回答：每個框放在哪、折成幾行、哪些實在放不下。
//
// 做法：在可用範圍裡鋪一張候選位置的網格，排除「蓋到事件文字、蓋到其他框、超出範圍」的位置，
// 剩下的挑離事件最近的一個（橫式另外偏好上下交錯）。找不到就縮短摘要再試，還是不行就只留標題，
// 最後才放棄並回報。**絕不蓋到事件的文字**——框把資料遮住等於說謊；寧可框放遠一點、引線拉長。
// 不寫通用的力導向排版（計畫書風險 4）。

import { wrapLines } from './layout'

/** ui 傳進來的標註：哪個事件、框裡寫什麼 */
export interface CalloutSpec {
  /** 事件組合鍵「圖層 id/事件 id」 */
  key: string
  title: string
  summary: string
}

/** 排好位置的標註框 */
export interface PlacedCallout {
  key: string
  x: number
  y: number
  w: number
  h: number
  /** 引線要連到的事件位置 */
  anchorX: number
  anchorY: number
  side: 'above' | 'below' | 'left' | 'right'
  titleLines: string[]
  summaryLines: string[]
}

/** 可以放框的範圍（畫布上扣掉標題列、刻度列、出處行之後） */
export interface CalloutBounds {
  left: number
  top: number
  right: number
  bottom: number
}

/** 排版需要的尺寸（已乘上主題倍率） */
export interface CalloutMetrics {
  boxW: number
  pad: number
  titleFont: number
  summaryFont: number
  lineHeight: number
  /** 框與事件之間至少留的距離 */
  gap: number
  /** 引線最長多長——太遠的框讀者對不回事件，寧可不放 */
  maxLeader: number
}

export interface CalloutLayout {
  placed: PlacedCallout[]
  /** 實在放不下、被省略的標註（key） */
  dropped: string[]
}

export type Rect = { x: number; y: number; w: number; h: number }

function overlaps(a: Rect, b: Rect, margin: number): boolean {
  return (
    a.x < b.x + b.w + margin &&
    b.x < a.x + a.w + margin &&
    a.y < b.y + b.h + margin &&
    b.y < a.y + a.h + margin
  )
}

/** 從事件到框最近的一點的距離（引線長度） */
export function leaderLength(box: Rect, ax: number, ay: number): number {
  const cx = Math.min(Math.max(ax, box.x), box.x + box.w)
  const cy = Math.min(Math.max(ay, box.y), box.y + box.h)
  return Math.hypot(ax - cx, ay - cy)
}

/**
 * 給每個標註找一個不蓋到事件文字、不跟其他框重疊、離事件最近的位置。
 * 橫式偏好上下交錯；直式通常落在右側預留的標註欄。
 */
export function placeCallouts(
  specs: Array<CalloutSpec & { anchorX: number; anchorY: number }>,
  bounds: CalloutBounds,
  orientation: 'horizontal' | 'vertical',
  m: CalloutMetrics,
  /** 畫面上已有的東西（事件圖形與文字）：絕不蓋到 */
  obstacles: Rect[] = [],
  /** 橫式偏好放在事件的哪一側；沒給就上下交錯（雙向對照：上半往上、下半往下） */
  prefer?: 'above' | 'below',
): CalloutLayout {
  const placed: PlacedCallout[] = []
  const dropped: string[] = []
  const textW = m.boxW - m.pad * 2
  const lh = (f: number) => f * m.lineHeight
  const margin = m.gap / 2

  // 由左到右（橫式）或由上到下（直式）處理，交錯上下才規律
  const ordered = [...specs].sort((a, b) =>
    orientation === 'horizontal' ? a.anchorX - b.anchorX : a.anchorY - b.anchorY,
  )

  ordered.forEach((spec, index) => {
    const titleLines = wrapLines(spec.title, textW, m.titleFont, 2)
    // 三個退路：完整摘要（兩行）→ 摘要一行 → 只留標題
    const variants = [2, 1, 0].map((n) => ({
      titleLines,
      summaryLines: n > 0 && spec.summary ? wrapLines(spec.summary, textW, m.summaryFont, n) : [],
    }))
    // 絕不蓋到事件文字：找不到空位就縮短摘要，再不行只留標題，最後才放棄
    for (const v of variants) {
      const h =
        m.pad * 2 + v.titleLines.length * lh(m.titleFont) + v.summaryLines.length * lh(m.summaryFont)
      const preferBelow = prefer ? prefer === 'below' : orientation === 'horizontal' && index % 2 === 1
      let best: (Rect & { side: PlacedCallout['side'] }) | null = null
      let bestScore = Infinity
      for (const c of gridCandidates(spec.anchorX, spec.anchorY, m.boxW, h, orientation, m.gap, bounds)) {
        const leader = leaderLength(c, spec.anchorX, spec.anchorY)
        if (leader > m.maxLeader || leader < m.gap) continue
        if (!placed.every((p) => !overlaps(c, p, margin))) continue
        if (!obstacles.every((o) => !overlaps(c, o, 0))) continue
        // 分數：引線越短越好；橫式偏好上下交錯（不在偏好那側就扣一點分）
        const wrongSide =
          orientation === 'horizontal' && (c.side === 'below') !== preferBelow ? m.gap * 3 : 0
        const score = leader + wrongSide
        if (score < bestScore) {
          best = c
          bestScore = score
        }
      }
      if (best) {
        placed.push({ ...best, key: spec.key, anchorX: spec.anchorX, anchorY: spec.anchorY, ...v })
        return
      }
    }
    dropped.push(spec.key)
  })

  return { placed, dropped }
}

/**
 * 候選位置：在可用範圍裡每隔一小段鋪一個框的位置（網格），框不能蓋到錨點本身。
 * side 記錄框在事件的哪一側，繪製與「上下交錯」偏好用得到。
 */
function gridCandidates(
  ax: number,
  ay: number,
  w: number,
  h: number,
  orientation: 'horizontal' | 'vertical',
  gap: number,
  bounds: CalloutBounds,
): Array<Rect & { side: PlacedCallout['side'] }> {
  const out: Array<Rect & { side: PlacedCallout['side'] }> = []
  const stepX = Math.max(8, w / 6)
  const stepY = Math.max(6, h / 4)
  for (let y = bounds.top; y + h <= bounds.bottom + 0.5; y += stepY) {
    for (let x = bounds.left; x + w <= bounds.right + 0.5; x += stepX) {
      // 框不能壓在事件上（至少隔一個間距）
      if (ax > x - gap && ax < x + w + gap && ay > y - gap && ay < y + h + gap) continue
      const side: PlacedCallout['side'] =
        orientation === 'horizontal' ? (y + h / 2 < ay ? 'above' : 'below') : x + w / 2 < ax ? 'left' : 'right'
      out.push({ x, y, w, h, side })
    }
    // 貼齊右緣的那一欄也要試（網格不一定剛好落在邊上）
    const xr = bounds.right - w
    if (!(ax > xr - gap && ay > y - gap && ay < y + h + gap)) {
      out.push({
        x: xr,
        y,
        w,
        h,
        side: orientation === 'horizontal' ? (y + h / 2 < ay ? 'above' : 'below') : xr + w / 2 < ax ? 'left' : 'right',
      })
    }
  }
  return out
}
