// 空白摺疊的數學測試：對應必須嚴格遞增、可雙向換算，
// 否則縮放平移在摺疊模式下會亂掉。
import { describe, expect, it } from 'vitest'
import { buildWarp } from './gaps'

const DAY = 86_400_000
const YEAR = 365.25 * DAY

describe('buildWarp', () => {
  it('關閉時直通：u 與 t 完全相同', () => {
    const warp = buildWarp([[0, 100]], false)
    expect(warp.active).toBe(false)
    expect(warp.toU(12345)).toBe(12345)
    expect(warp.toT(12345)).toBe(12345)
  })

  it('沒有夠大的空白時直通（小空隙不摺疊）', () => {
    // 兩段事件相隔只佔整體 5%，低於 10% 門檻
    const warp = buildWarp(
      [
        [0, 45 * YEAR],
        [50 * YEAR, 100 * YEAR],
      ],
      true,
    )
    expect(warp.active).toBe(false)
    expect(warp.gaps).toEqual([])
  })

  it('大空白會被摺疊：壓縮後距離變短、並列在 gaps 清單', () => {
    // 1865–1870 有事件，1950–2020 有事件，中間 80 年空白（遠超過 10%）
    const spans: Array<[number, number]> = [
      [1865 * YEAR, 1870 * YEAR],
      [1950 * YEAR, 2020 * YEAR],
    ]
    const warp = buildWarp(spans, true)
    expect(warp.active).toBe(true)
    expect(warp.gaps.length).toBe(1)
    // 壓縮後：兩事件群在 u 座標的距離遠小於真實時間距離
    const uDistance = warp.toU(1950 * YEAR) - warp.toU(1870 * YEAR)
    const tDistance = 80 * YEAR
    expect(uDistance).toBeLessThan(tDistance / 5)
    // 略過的時長大約是空白長度（扣掉呼吸空間）
    expect(warp.gaps[0].skippedMs).toBeGreaterThan(70 * YEAR)
  })

  it('對應嚴格遞增，且雙向換算互為反函數', () => {
    const spans: Array<[number, number]> = [
      [0, 10 * YEAR],
      [100 * YEAR, 110 * YEAR],
      [200 * YEAR, 210 * YEAR],
    ]
    const warp = buildWarp(spans, true)
    expect(warp.gaps.length).toBe(2)
    // 取樣多個時間點（含空白內、事件內、範圍外）
    const samples = [-5, 3, 9.9, 30, 55, 99, 105, 150, 205, 250].map((y) => y * YEAR)
    let prevU = -Infinity
    for (const t of samples) {
      const u = warp.toU(t)
      expect(u, `toU(${t / YEAR}年) 應嚴格遞增`).toBeGreaterThan(prevU)
      prevU = u
      // 反函數：誤差在一毫秒內
      expect(Math.abs(warp.toT(u) - t)).toBeLessThan(1)
    }
  })

  it('密集區內斜率為 1：u 座標的間距與真實時間一致（縮放手感不變）', () => {
    const spans: Array<[number, number]> = [
      [0, 10 * YEAR],
      [100 * YEAR, 110 * YEAR],
    ]
    const warp = buildWarp(spans, true)
    // 在第二個密集區內取兩點，u 間距 = t 間距
    const a = warp.toU(102 * YEAR)
    const b = warp.toU(108 * YEAR)
    expect(Math.abs(b - a - 6 * YEAR)).toBeLessThan(1)
  })
})
