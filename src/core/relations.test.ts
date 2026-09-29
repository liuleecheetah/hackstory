// 跨文件關係的判斷。
// 重點情境：外部事件 id「剛好」與本文件某事件同名——這正是會畫錯線的那種資料。
import { describe, expect, it } from 'vitest'
import type { HstEvent, Relation } from './types'
import {
  isCrossDocument,
  isRelationReversed,
  nextRelationId,
  removeRelationFrom,
  sameDocumentRelations,
} from './relations'

describe('isCrossDocument', () => {
  it('沒有 fromDoc／toDoc → 本文件內的關係', () => {
    expect(isCrossDocument({ fromDoc: undefined, toDoc: undefined })).toBe(false)
  })

  it('有 toDoc → 跨文件', () => {
    expect(isCrossDocument({ toDoc: 'other-timeline' })).toBe(true)
  })

  it('有 fromDoc → 跨文件', () => {
    expect(isCrossDocument({ fromDoc: 'other-timeline' })).toBe(true)
  })
})

describe('sameDocumentRelations — 繪製與匯出都只該拿到本文件的關係', () => {
  it('跨文件關係被濾掉，即使它的事件 id 與本文件事件同名', () => {
    const relations: Relation[] = [
      { from: 'evt-001', to: 'evt-002', type: 'causes' },
      // 這條的 to 指向「別份文件」的 evt-002——但本文件也有一個 evt-002
      { from: 'evt-001', to: 'evt-002', toDoc: 'other-timeline', type: 'same_event' },
    ]
    const kept = sameDocumentRelations(relations)
    expect(kept).toHaveLength(1)
    expect(kept[0].type).toBe('causes')
  })

  it('沒有 relations（undefined）→ 空陣列，不會爆', () => {
    expect(sameDocumentRelations(undefined)).toEqual([])
  })
})

describe('nextRelationId — 文件內不重複', () => {
  it('空清單 → 產生一個 rel- 開頭的 id', () => {
    const id = nextRelationId([])
    expect(id.startsWith('rel-')).toBe(true)
  })

  it('撞到既有 id 時會換一個（不會產生重複）', () => {
    const first = nextRelationId([])
    // 故意把剛產生的 id 放進既有清單，再要一次
    const second = nextRelationId([{ id: first, from: 'a', to: 'b', type: 'causes' }])
    expect(second).not.toBe(first)
  })
})

describe('removeRelationFrom — 依身分刪除，不依陣列位置', () => {
  const withIds: Relation[] = [
    { id: 'rel-1', from: 'a', to: 'b', type: 'causes' },
    { id: 'rel-2', from: 'b', to: 'c', type: 'responds_to' },
    { id: 'rel-3', from: 'c', to: 'd', type: 'derives_from' },
  ]

  it('有 id：即使位置變了也刪對那一條', () => {
    // 模擬「畫面記住的是第 3 條，但陣列已經被別的編輯重排」
    const reordered = [withIds[2], withIds[0], withIds[1]]
    const result = removeRelationFrom(reordered, withIds[2])
    expect(result.map((r) => r.id)).toEqual(['rel-1', 'rel-2'])
  })

  it('舊資料沒有 id：比對內容，且只刪一條（不會誤刪其他相同內容的）', () => {
    const legacy: Relation[] = [
      { from: 'a', to: 'b', type: 'causes' },
      { from: 'a', to: 'b', type: 'causes' },
      { from: 'x', to: 'y', type: 'causes' },
    ]
    const result = removeRelationFrom(legacy, { from: 'a', to: 'b', type: 'causes' })
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ from: 'a', to: 'b', type: 'causes' })
    expect(result[1]).toEqual({ from: 'x', to: 'y', type: 'causes' })
  })

  it('刪除沒有 id 的舊關係時，不會誤刪有 id 的關係', () => {
    const mixed: Relation[] = [
      { id: 'rel-1', from: 'a', to: 'b', type: 'causes' },
      { from: 'a', to: 'b', type: 'causes' },
    ]
    const result = removeRelationFrom(mixed, { from: 'a', to: 'b', type: 'causes' })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('rel-1')
  })
})

describe('isRelationReversed：關係方向跟時間先後明顯矛盾', () => {
  const at = (value: string, precision: 'year' | 'day' = 'day'): HstEvent => ({
    id: value,
    track: 't',
    title: value,
    start: { value, precision },
  })

  it('「導致」：原因比結果晚才算顛倒', () => {
    expect(isRelationReversed('causes', at('2001-01-01'), at('2000-01-01'))).toBe(true)
    expect(isRelationReversed('causes', at('2000-01-01'), at('2001-01-01'))).toBe(false)
  })

  it('「回應」「衍生自」：回應的一方比被回應的早才算顛倒', () => {
    expect(isRelationReversed('responds_to', at('2000-01-01'), at('2001-01-01'))).toBe(true)
    expect(isRelationReversed('derives_from', at('2000-01-01'), at('2001-01-01'))).toBe(true)
    expect(isRelationReversed('responds_to', at('2001-01-01'), at('2000-01-01'))).toBe(false)
  })

  it('時間範圍重疊（同一年、精度只到年）不算', () => {
    expect(isRelationReversed('causes', at('2000', 'year'), at('2000-03-01'))).toBe(false)
    expect(isRelationReversed('causes', at('2000-05-01'), at('2000-05-01'))).toBe(false)
  })

  it('相對時間、矛盾、同一事件不判斷', () => {
    const rel: HstEvent = { id: 'r', track: 't', title: 'r', start: { relative: { after: 'x' } } }
    expect(isRelationReversed('causes', rel, at('2000-01-01'))).toBe(false)
    expect(isRelationReversed('contradicts', at('2001-01-01'), at('2000-01-01'))).toBe(false)
    expect(isRelationReversed('same_event', at('2001-01-01'), at('2000-01-01'))).toBe(false)
  })
})
