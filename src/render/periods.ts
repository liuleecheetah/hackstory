// render 層：時期底色帶的排版（純函式，沒有畫面）
//
// 文件的 periods（SPEC 7.5，例如「戒嚴時期 1949–1987」）要畫成時間軸後面的淡色底。
// 這裡只回答：每一段從哪裡到哪裡（座標 u，跟事件用同一個 warp，所以摺疊空白、
// 順序等距時會跟著壓縮）、用什麼顏色。畫在哪個像素由各檢視自己換算。

import type { Period } from '../core'
import type { TimeWarp } from './gaps'
import { timePointToSpan } from './timeScale'
import type { TimelineSource } from './types'

/** 一段排好的時期底色 */
export interface PeriodBand {
  key: string
  title: string
  description?: string
  /** 起訖（座標 u） */
  u0: number
  u1: number
  /** 底色與不透明度：自訂色碼畫得淡一點，自動配色本身已經很淡 */
  fill: string
  opacity: number
  /** 沒有結束時間 = 至今 */
  openEnded: boolean
}

const RE_HEX_COLOR = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/
/** 使用者自訂的底色畫多淡（色碼通常是實色，直接鋪滿會蓋過事件） */
const CUSTOM_OPACITY = 0.45

/**
 * 把一份文件的時期換算成底色帶。
 * fills：沒指定顏色時輪流使用的淡色（主題提供）。now：「至今」畫到哪裡。
 */
export function layoutPeriods(
  periods: Period[] | undefined,
  warp: TimeWarp,
  fills: string[],
  keyPrefix = '',
  now = Date.now(),
): PeriodBand[] {
  if (!periods || periods.length === 0) return []
  return periods.flatMap((p, i) => {
    // 驗證器已擋下格式錯誤的檔案；這裡再保險一次，壞掉的一段就跳過，不讓整張圖畫不出來
    let t0: number
    let t1: number
    try {
      t0 = timePointToSpan(p.start).start.getTime()
      t1 = p.end ? timePointToSpan(p.end).end.getTime() : Math.max(now, t0)
    } catch {
      return []
    }
    if (!Number.isFinite(t0) || !Number.isFinite(t1)) return []
    const custom = typeof p.color === 'string' && RE_HEX_COLOR.test(p.color)
    const u0 = warp.toU(Math.min(t0, t1))
    const u1 = warp.toU(Math.max(t0, t1))
    return [
      {
        key: `${keyPrefix}${p.id ?? `period-${i}`}`,
        title: p.title,
        description: p.description,
        u0,
        u1,
        fill: custom ? p.color! : fills[i % Math.max(1, fills.length)] ?? '#eeeeee',
        opacity: custom ? CUSTOM_OPACITY : 1,
        openEnded: !p.end,
      },
    ]
  })
}

/**
 * 哪一份文件的時期畫成滿版底色：圖層順序裡第一份有時期的。
 * 其他圖層的時期只畫成刻度旁的細條——多份文件的底色疊在一起會互相蓋掉，誰也看不清。
 */
export function periodSources(sources: TimelineSource[]): {
  primary: TimelineSource | null
  others: TimelineSource[]
} {
  const withPeriods = sources.filter((s) => (s.doc.periods?.length ?? 0) > 0)
  return { primary: withPeriods[0] ?? null, others: withPeriods.slice(1) }
}
