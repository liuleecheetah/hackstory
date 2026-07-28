// 跨文件關係的判斷。
// 重點情境：外部事件 id「剛好」與本文件某事件同名——這正是會畫錯線的那種資料。
import { describe, expect, it } from 'vitest'
import type { Relation } from './types'
import { isCrossDocument, sameDocumentRelations } from './relations'

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
