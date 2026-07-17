// 相對時間求解器的測試。
// 這是「只知道先後、不知道日期」也能建時間軸的核心——順序不對就全毀，所以測仔細。
import { describe, expect, it } from 'vitest'
import { relativeDependsOn, removeEventFromDocument, resolveRelativeEvents } from './relative'
import type { HstEvent, TimelineDocument } from './types'

/** 建一份測試文件：兩個絕對事件（2020 年初、2021 年初）＋傳入的相對事件 */
function docWith(...events: Partial<HstEvent>[]): TimelineDocument {
  return {
    hackstory: '0.2',
    id: 'test',
    meta: { title: '測試' },
    tracks: [{ id: 'main', title: '主軸' }],
    events: [
      { id: 'A', track: 'main', title: 'Ａ', start: { value: '2020-01-01', precision: 'day' } },
      { id: 'B', track: 'main', title: 'Ｂ', start: { value: '2021-01-01', precision: 'day' } },
      ...(events as HstEvent[]),
    ],
  }
}

const T_A = new Date(2020, 0, 1).getTime()
const T_B = new Date(2021, 0, 1).getTime()

const rel = (id: string, relative: { after?: string; before?: string }): Partial<HstEvent> => ({
  id,
  track: 'main',
  title: id,
  start: { relative },
})

describe('resolveRelativeEvents', () => {
  it('沒有相對事件 → 空結果', () => {
    const result = resolveRelativeEvents(docWith())
    expect(result.positions.size).toBe(0)
    expect(result.unresolved).toEqual([])
  })

  it('夾在兩個絕對事件之間：推估位置嚴格落在 A、B 之間', () => {
    const result = resolveRelativeEvents(docWith(rel('R', { after: 'A', before: 'B' })))
    const t = result.positions.get('R')!
    expect(t).toBeGreaterThan(T_A)
    expect(t).toBeLessThan(T_B)
    expect(result.unresolved).toEqual([])
  })

  it('只有「之後」：畫在參考事件的右邊', () => {
    const result = resolveRelativeEvents(docWith(rel('R', { after: 'B' })))
    expect(result.positions.get('R')!).toBeGreaterThan(T_B)
  })

  it('只有「之前」：畫在參考事件的左邊', () => {
    const result = resolveRelativeEvents(docWith(rel('R', { before: 'A' })))
    expect(result.positions.get('R')!).toBeLessThan(T_A)
  })

  it('同一段區間內的多個相對事件：分散放置、互不重疊', () => {
    const result = resolveRelativeEvents(
      docWith(
        rel('R1', { after: 'A', before: 'B' }),
        rel('R2', { after: 'A', before: 'B' }),
        rel('R3', { after: 'A', before: 'B' }),
      ),
    )
    const ts = ['R1', 'R2', 'R3'].map((id) => result.positions.get(id)!)
    for (const t of ts) {
      expect(t).toBeGreaterThan(T_A)
      expect(t).toBeLessThan(T_B)
    }
    expect(new Set(ts).size).toBe(3) // 三個位置各不相同
  })

  it('相對事件串成鏈：R2 在 R1 之後，畫出來也真的在 R1 右邊', () => {
    const result = resolveRelativeEvents(
      docWith(rel('R1', { after: 'A', before: 'B' }), rel('R2', { after: 'R1', before: 'B' })),
    )
    const t1 = result.positions.get('R1')!
    const t2 = result.positions.get('R2')!
    expect(t1).toBeGreaterThan(T_A)
    expect(t2).toBeGreaterThan(t1)
    expect(t2).toBeLessThan(T_B)
  })

  it('鏈的參考可以一路傳遞到絕對事件：R2 → R1 → A', () => {
    const result = resolveRelativeEvents(
      docWith(rel('R1', { after: 'A' }), rel('R2', { after: 'R1' })),
    )
    const t1 = result.positions.get('R1')!
    const t2 = result.positions.get('R2')!
    expect(t1).toBeGreaterThan(T_A)
    expect(t2).toBeGreaterThan(t1)
  })

  it('互相循環 → 收進 unresolved，不亂畫', () => {
    const result = resolveRelativeEvents(
      docWith(rel('R1', { after: 'R2' }), rel('R2', { after: 'R1' })),
    )
    expect(result.positions.has('R1')).toBe(false)
    expect(result.positions.has('R2')).toBe(false)
    expect(result.unresolved.length).toBe(2)
  })

  it('條件矛盾（在 B 之後、又在 A 之前）→ 收進 unresolved 並說明原因', () => {
    const result = resolveRelativeEvents(docWith(rel('R', { after: 'B', before: 'A' })))
    expect(result.positions.has('R')).toBe(false)
    expect(result.unresolved[0]?.reason).toContain('矛盾')
  })
})

describe('relativeDependsOn（介面防循環用）', () => {
  it('直接依賴與間接依賴都抓得到；無依賴回傳 false', () => {
    const doc = docWith(rel('R1', { after: 'A' }), rel('R2', { after: 'R1' }))
    expect(relativeDependsOn(doc, 'R1', 'A')).toBe(true) // 直接
    expect(relativeDependsOn(doc, 'R2', 'A')).toBe(true) // 間接（R2 → R1 → A）
    expect(relativeDependsOn(doc, 'R1', 'B')).toBe(false)
    expect(relativeDependsOn(doc, 'A', 'R1')).toBe(false) // 絕對事件不依賴任何人
  })

  it('資料裡已有循環也不會無窮迴圈', () => {
    const doc = docWith(rel('R1', { after: 'R2' }), rel('R2', { after: 'R1' }))
    expect(relativeDependsOn(doc, 'R1', 'A')).toBe(false)
  })
})

describe('removeEventFromDocument（刪除事件的連鎖處理）', () => {
  it('刪除被參考的事件：其他事件失去該參考但保留另一個，不會變壞資料', () => {
    const doc = docWith(rel('R', { after: 'A', before: 'B' }))
    const result = removeEventFromDocument(doc, 'A')
    const r = result.doc.events.find((e) => e.id === 'R')!
    expect(r.start).toEqual({ relative: { before: 'B' } })
    expect(result.referencesCleaned.map((e) => e.id)).toEqual(['R'])
    expect(result.cascadeRemoved).toEqual([])
  })

  it('失去所有參考的相對事件連鎖刪除（一路傳下去）', () => {
    const doc = docWith(rel('R1', { after: 'A' }), rel('R2', { after: 'R1' }))
    const result = removeEventFromDocument(doc, 'A')
    // A 刪除 → R1 失去唯一參考 → 刪除 → R2 失去唯一參考 → 刪除
    expect(result.doc.events.map((e) => e.id)).toEqual(['B'])
    expect(result.cascadeRemoved.map((e) => e.id).sort()).toEqual(['R1', 'R2'])
  })

  it('指向被刪（含連鎖被刪）事件的關係線一併移除', () => {
    const doc = docWith(rel('R1', { after: 'A' }))
    doc.relations = [
      { from: 'B', to: 'R1', type: 'causes' }, // R1 會連鎖刪除 → 這條要清掉
      { from: 'A', to: 'B', type: 'causes' }, // A 直接刪除 → 這條要清掉
    ]
    const result = removeEventFromDocument(doc, 'A')
    expect(result.doc.relations).toEqual([])
  })

  it('刪除後的文件通過 SPEC 驗證（不會留下壞資料）', async () => {
    const { validateDocument } = await import('./validate')
    const doc = docWith(rel('R1', { after: 'A', before: 'B' }), rel('R2', { after: 'R1' }))
    const result = removeEventFromDocument(doc, 'A')
    expect(validateDocument(result.doc).ok).toBe(true)
  })
})
