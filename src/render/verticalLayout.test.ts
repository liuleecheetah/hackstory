// 直式排版的數學測試：欄放不放得下、欄怎麼切、上下打架的事件怎麼錯開。
import { describe, expect, it } from 'vitest'
import {
  columnRects,
  fitContentHeight,
  countDroppedLabels,
  fitText,
  pickVerticalMode,
  RULER_W,
  shapeGutter,
  stackLabels,
  verticalLanes,
  visibleURange,
} from './verticalLayout'

describe('pickVerticalMode：多欄並排或單欄合流', () => {
  it('欄寬剛好 180px 時仍用多欄並排（臨界值含等於）', () => {
    // 3 欄 × 180px + 刻度尺 64px = 604px
    expect(pickVerticalMode(604, 3)).toBe('columns')
  })

  it('再窄 1px 就退成單欄合流', () => {
    expect(pickVerticalMode(603, 3)).toBe('merged')
  })

  it('手機寬度單一軸線仍是多欄（只有一欄）', () => {
    expect(pickVerticalMode(375, 1)).toBe('columns')
  })

  it('手機寬度三條軸線 → 合流', () => {
    expect(pickVerticalMode(375, 3)).toBe('merged')
  })

  it('沒有軸線時不會除以零', () => {
    expect(pickVerticalMode(800, 0)).toBe('columns')
  })
})

describe('columnRects：每欄的位置與寬度', () => {
  it('第一欄從刻度尺右緣開始，各欄寬度相同且不重疊', () => {
    const rects = columnRects(664, 3)
    expect(rects.map((r) => r.x)).toEqual([RULER_W, RULER_W + 200, RULER_W + 400])
    expect(rects.map((r) => r.w)).toEqual([200, 200, 200])
  })

  it('所有欄寬加總 = 扣掉刻度尺後的可用寬度（不多不少）', () => {
    const rects = columnRects(1000, 7)
    const total = rects.reduce((sum, r) => sum + r.w, 0)
    expect(total).toBeCloseTo(1000 - RULER_W, 6)
  })

  it('容器比刻度尺還窄時不會給出負寬度', () => {
    expect(columnRects(40, 2).every((r) => r.w >= 0)).toBe(true)
  })

  it('沒有軸線時回傳空陣列', () => {
    expect(columnRects(800, 0)).toEqual([])
  })
})

describe('verticalLanes：上下打架的事件往右錯開', () => {
  it('時間分得夠開的事件全部待在第 0 車道', () => {
    const lanes = verticalLanes([
      { top: 0, bottom: 18 },
      { top: 40, bottom: 58 },
      { top: 80, bottom: 98 },
    ])
    expect(lanes).toEqual([0, 0, 0])
  })

  it('垂直重疊的事件被分到不同車道', () => {
    const lanes = verticalLanes([
      { top: 0, bottom: 18 },
      { top: 5, bottom: 23 },
      { top: 10, bottom: 28 },
    ])
    expect(new Set(lanes).size).toBe(3)
  })

  it('同一車道內的事件保證不重疊', () => {
    const slots = [
      { top: 0, bottom: 20 },
      { top: 4, bottom: 24 },
      { top: 30, bottom: 50 },
      { top: 34, bottom: 54 },
      { top: 60, bottom: 80 },
    ]
    const lanes = verticalLanes(slots)
    const byLane = new Map<number, Array<{ top: number; bottom: number }>>()
    slots.forEach((s, i) => {
      const list = byLane.get(lanes[i]) ?? []
      list.push(s)
      byLane.set(lanes[i], list)
    })
    for (const list of byLane.values()) {
      list.sort((a, b) => a.top - b.top)
      for (let i = 1; i < list.length; i++) {
        expect(list[i].top).toBeGreaterThanOrEqual(list[i - 1].bottom)
      }
    }
  })
})

describe('stackLabels：標題往下擠開，但擠不過頭', () => {
  it('分得夠開的標題原地不動', () => {
    expect(stackLabels([0, 40, 80], 18)).toEqual([0, 40, 80])
  })

  it('擠在一起的標題被依序往下推，間距剛好等於一行高', () => {
    expect(stackLabels([0, 2, 4], 18)).toEqual([0, 18, 36])
  })

  it('推開之後任兩個標題都不重疊', () => {
    const placed = stackLabels([0, 1, 2, 3, 50, 51, 200], 18) as number[]
    for (let i = 1; i < placed.length; i++) {
      expect(placed[i] - placed[i - 1]).toBeGreaterThanOrEqual(18)
    }
  })

  it('只會往下推，不會往上跑（標題不可能出現在事件上方）', () => {
    const natural = [0, 1, 2, 3, 50]
    stackLabels(natural, 18).forEach((yv, i) => expect(yv!).toBeGreaterThanOrEqual(natural[i]))
  })

  it('要離真實位置太遠才排得下的標題，寧可不畫（回傳 null）', () => {
    // 五件事全部發生在同一時間，最多只排得下前兩個（位移 0、18），第三個起就超過 26
    expect(stackLabels([100, 100, 100, 100, 100], 18, 26)).toEqual([100, 118, null, null, null])
  })

  it('被捨棄的標題不佔位置，後面排得下的照樣畫得出來', () => {
    // 200 那件離得夠遠，不受前面塞車影響
    expect(stackLabels([0, 0, 0, 200], 18, 26)).toEqual([0, 18, null, 200])
  })

  it('countDroppedLabels 數得出有幾件沒顯示', () => {
    expect(countDroppedLabels([100, 100, 100, 100, 100], 18, 26)).toBe(3)
    expect(countDroppedLabels([0, 40, 80], 18, 26)).toBe(0)
  })
})

describe('fitContentHeight：擠不下就把軸拉長', () => {
  it('事件分布均勻時用最短高度就夠了', () => {
    const positions = Array.from({ length: 10 }, (_, i) => i / 9)
    expect(fitContentHeight([positions], { minH: 520 })).toBe(520)
  })

  it('事件擠在同一小段時間時，軸會被拉長到全部標題都排得下', () => {
    const positions = Array.from({ length: 20 }, (_, i) => (i / 19) * 0.05)
    const h = fitContentHeight([positions], { minH: 520 })
    expect(h).toBeGreaterThan(520)
    expect(countDroppedLabels(positions.map((p) => p * h), 18, 26)).toBe(0)
  })

  it('再怎麼擠也有高度上限，不會產生瀏覽器畫不動的巨大 SVG', () => {
    const positions = Array.from({ length: 300 }, () => 0.5)
    expect(fitContentHeight([positions], { maxH: 12_000 })).toBe(12_000)
  })

  it('沒有事件時回傳最短高度', () => {
    expect(fitContentHeight([[]], { minH: 520 })).toBe(520)
    expect(fitContentHeight([], { minH: 520 })).toBe(520)
  })

  it('以最擠的那一欄為準（其他欄比較鬆也要跟著拉長）', () => {
    const loose = Array.from({ length: 10 }, (_, i) => i / 9)
    const tight = Array.from({ length: 20 }, (_, i) => (i / 19) * 0.05)
    expect(fitContentHeight([loose, tight])).toBeGreaterThan(fitContentHeight([loose]))
  })
})

describe('visibleURange：畫面上真正看得到的那一段', () => {
  // 軸從 y=100 開始、長 1000px，對應時間 0–2000
  const call = (scrollTop: number, viewportH: number) =>
    visibleURange(scrollTop, viewportH, 100, 1000, [0, 2000])

  it('捲到最上面時，從整條軸的開頭算起', () => {
    expect(call(0, 500)).toEqual([0, 800])
  })

  it('捲到中間時只回報中間那一段', () => {
    expect(call(600, 500)).toEqual([1000, 2000])
  })

  it('捲到最下面時，結尾就是整條軸的結尾（不會超出去）', () => {
    expect(call(1200, 500)).toEqual([2000, 2000])
  })

  it('視窗比整條軸還高時，回報的就是整條軸', () => {
    expect(call(0, 5000)).toEqual([0, 2000])
  })

  it('永遠夾在整條軸的範圍內，不會回報資料以外的時間', () => {
    const [a, b] = call(-500, 300)
    expect(a).toBeGreaterThanOrEqual(0)
    expect(b).toBeLessThanOrEqual(2000)
  })
})

describe('shapeGutter：圖形區要留多寬', () => {
  it('沒有事件時不留空間', () => {
    expect(shapeGutter([], 16)).toBe(0)
  })

  it('全部在第 0 車道時，寬度就是最寬的那個圖形', () => {
    expect(shapeGutter([{ lane: 0, width: 10 }, { lane: 0, width: 15 }], 16)).toBe(15)
  })

  it('有副車道時要加上錯開的距離', () => {
    expect(shapeGutter([{ lane: 2, width: 12 }], 16)).toBe(44)
  })

  it('取最外側的那一個，不是最後一個', () => {
    expect(
      shapeGutter([{ lane: 3, width: 10 }, { lane: 0, width: 15 }], 16),
    ).toBe(58)
  })
})

describe('fitText：依欄寬截斷', () => {
  it('放得下就原封不動', () => {
    expect(fitText('短標題', 200, 12)).toBe('短標題')
  })

  it('放不下就截斷並加省略號', () => {
    const out = fitText('這是一個很長很長很長的中文標題', 60, 12)
    expect(out.endsWith('…')).toBe(true)
    expect(out.length).toBeLessThan('這是一個很長很長很長的中文標題'.length)
  })

  it('寬度是 0 或負數時不硬畫，回傳空字串', () => {
    expect(fitText('標題', 0, 12)).toBe('')
    expect(fitText('標題', -20, 12)).toBe('')
  })

  it('中文字比拉丁字寬，同樣寬度放得下的字數比較少', () => {
    expect(fitText('abcdefghijklmnop', 60, 12).length).toBeGreaterThan(
      fitText('一二三四五六七八九十', 60, 12).length,
    )
  })
})
