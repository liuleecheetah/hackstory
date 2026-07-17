// core 層：相對時間求解器
// 「不知道確切日期、只知道先後順序」的事件（start.relative.after / before），
// 依約束推估出一個合成位置，讓 render 層畫在軸上。
// 這是 HackStory 三個差異化定位的最後一塊（SPEC 第 4 節）。
//
// 原則：
// 1. 推估位置一定落在「之後」與「之前」參考事件之間；串成鏈的事件保持先後。
// 2. 循環或互相矛盾的約束不亂畫——收進 unresolved 清單回報，絕不靜默。

import { absolutePointRange } from './time'
import type { HstEvent, RelativeAnchor, TimelineDocument } from './types'
import { isAbsolute } from './types'

/**
 * 判斷 candidate 事件的相對時間鏈是否（直接或間接）依賴 target 事件。
 * 介面用它過濾「之後／之前」下拉選單，防止使用者建立循環。
 */
export function relativeDependsOn(
  doc: TimelineDocument,
  candidateId: string,
  targetId: string,
): boolean {
  const byId = new Map(doc.events.map((e) => [e.id, e]))
  const seen = new Set<string>()
  const walk = (id: string): boolean => {
    if (id === targetId) return true
    if (seen.has(id)) return false
    seen.add(id)
    const ev = byId.get(id)
    if (!ev || isAbsolute(ev.start)) return false
    const rel = (ev.start as RelativeAnchor).relative
    return (rel.after !== undefined && walk(rel.after)) ||
      (rel.before !== undefined && walk(rel.before))
  }
  return walk(candidateId)
}

export interface EventRemovalResult {
  doc: TimelineDocument
  /** 因失去所有相對時間參考而一併刪除的事件（可能連鎖） */
  cascadeRemoved: HstEvent[]
  /** 失去一個參考、但仍保留另一個而繼續存在的事件 */
  referencesCleaned: HstEvent[]
}

/**
 * 從文件中刪除一個事件，並處理所有連鎖影響：
 * - 指向它的關係線一併移除
 * - 其他事件的相對時間參考（after／before）指向它的，該參考被清除
 * - 參考清空後一個不剩的相對事件，連鎖刪除（否則檔案會留下壞資料、無法通過驗證）
 */
export function removeEventFromDocument(
  doc: TimelineDocument,
  eventId: string,
): EventRemovalResult {
  const removedIds = new Set<string>([eventId])
  let events = doc.events.filter((e) => e.id !== eventId)

  // 反覆清理，直到沒有事件再受影響（連鎖可能一層層傳下去）
  let changed = true
  while (changed) {
    changed = false
    events = events.flatMap((ev) => {
      if (isAbsolute(ev.start)) return [ev]
      const rel = (ev.start as RelativeAnchor).relative
      const hitAfter = rel.after !== undefined && removedIds.has(rel.after)
      const hitBefore = rel.before !== undefined && removedIds.has(rel.before)
      if (!hitAfter && !hitBefore) return [ev]
      const after = hitAfter ? undefined : rel.after
      const before = hitBefore ? undefined : rel.before
      if (after === undefined && before === undefined) {
        removedIds.add(ev.id)
        changed = true
        return []
      }
      return [
        {
          ...ev,
          start: { relative: { ...(after ? { after } : {}), ...(before ? { before } : {}) } },
        },
      ]
    })
  }

  const finalIds = new Set(events.map((e) => e.id))
  const cascadeRemoved = doc.events.filter((e) => e.id !== eventId && !finalIds.has(e.id))
  const referencesCleaned = events.filter((e) => {
    const original = doc.events.find((o) => o.id === e.id)
    return original !== undefined && original !== e
  })

  const relations = (doc.relations ?? []).filter(
    (r) => !removedIds.has(r.from) && !removedIds.has(r.to),
  )

  return {
    doc: { ...doc, events, ...(doc.relations ? { relations } : {}) },
    cascadeRemoved,
    referencesCleaned,
  }
}

export interface UnresolvedRelative {
  id: string
  reason: string
}

export interface RelativeResolution {
  /** 相對時間事件 id → 推估位置（毫秒） */
  positions: Map<string, number>
  /** 無法推估的事件與原因 */
  unresolved: UnresolvedRelative[]
}

const DAY = 86_400_000

/** 求解一份文件內所有相對時間事件的推估位置 */
export function resolveRelativeEvents(doc: TimelineDocument): RelativeResolution {
  const positions = new Map<string, number>()
  const unresolved: UnresolvedRelative[] = []

  // 絕對事件的定位（start 範圍中點）
  const known = new Map<string, number>()
  const relatives: Array<{ id: string; after?: string; before?: string }> = []
  for (const ev of doc.events) {
    if (isAbsolute(ev.start)) {
      const r = absolutePointRange(ev.start)
      known.set(ev.id, (r.start + r.end) / 2)
    } else {
      const rel = (ev.start as RelativeAnchor).relative
      relatives.push({ id: ev.id, after: rel.after, before: rel.before })
    }
  }
  if (relatives.length === 0) return { positions, unresolved }

  // 推估的間距單位：整體範圍的 3%（沒有絕對事件時退回 30 天）
  const knownValues = [...known.values()]
  const span =
    knownValues.length >= 2 ? Math.max(...knownValues) - Math.min(...knownValues) : 0
  const step = span > 0 ? span * 0.03 : 30 * DAY

  // ---- 第一步：界限傳播 ----
  // 反覆把「之後／之前」的參考往每個相對事件的 [min, max] 收斂。
  // 參考也可以是另一個相對事件（透過它的界限傳遞），所以要迭代到穩定。
  const bounds = new Map<string, { min: number; max: number }>()
  for (const r of relatives) bounds.set(r.id, { min: -Infinity, max: Infinity })

  const boundOf = (id: string | undefined, side: 'min' | 'max'): number | null => {
    if (!id) return null
    if (known.has(id)) return known.get(id)!
    const b = bounds.get(id)
    if (!b) return null // 指向不存在的事件（驗證器會另外報錯）
    const v = side === 'min' ? b.min : b.max
    return Number.isFinite(v) ? v : null
  }

  for (let pass = 0; pass < relatives.length + 2; pass++) {
    let changed = false
    for (const r of relatives) {
      const b = bounds.get(r.id)!
      const lo = boundOf(r.after, 'min')
      if (lo !== null && lo > b.min) {
        b.min = lo
        changed = true
      }
      const hi = boundOf(r.before, 'max')
      if (hi !== null && hi < b.max) {
        b.max = hi
        changed = true
      }
    }
    if (!changed) break
  }

  // ---- 第二步：鏈深度 ----
  // 沿「之後」鏈到絕對事件的距離，決定同一段區間內的先後順序
  const depthOf = (id: string, seen: Set<string>): number => {
    if (known.has(id)) return 0
    if (seen.has(id)) return relatives.length + 1 // 循環：給個大深度，稍後仍會被界限檢查攔下
    seen.add(id)
    const r = relatives.find((x) => x.id === id)
    if (!r?.after) return 0
    return depthOf(r.after, seen) + 1
  }
  const depth = new Map<string, number>()
  for (const r of relatives) depth.set(r.id, depthOf(r.id, new Set()))

  // ---- 第三步：依界限分組、組內平均分佈 ----
  const groups = new Map<string, typeof relatives>()
  for (const r of relatives) {
    const b = bounds.get(r.id)!
    if (!Number.isFinite(b.min) && !Number.isFinite(b.max)) {
      unresolved.push({
        id: r.id,
        reason: '找不到可定位的參考事件（可能互相循環，或指向的事件本身也無法定位）',
      })
      continue
    }
    if (Number.isFinite(b.min) && Number.isFinite(b.max) && b.min >= b.max) {
      unresolved.push({ id: r.id, reason: '「之後」與「之前」的條件互相矛盾' })
      continue
    }
    const key = `${b.min}|${b.max}`
    const list = groups.get(key)
    if (list) list.push(r)
    else groups.set(key, [r])
  }

  for (const members of groups.values()) {
    const { min, max } = bounds.get(members[0].id)!
    // 依鏈深度排序（穩定排序保留文件順序），讓「Ｂ在Ａ之後」畫在Ａ右邊
    members.sort((a, z) => depth.get(a.id)! - depth.get(z.id)!)
    members.forEach((r, i) => {
      let t: number
      if (Number.isFinite(min) && Number.isFinite(max)) {
        t = min + ((i + 1) / (members.length + 1)) * (max - min)
      } else if (Number.isFinite(min)) {
        t = min + step * (i + 1)
      } else {
        t = max - step * (members.length - i)
      }
      positions.set(r.id, t)
    })
  }

  // ---- 第四步：保險檢查 ----
  // 確保每個推估位置真的落在它的參考之後／之前（跨組的鏈在這裡校正）
  const finalOf = (id?: string): number | undefined =>
    id === undefined ? undefined : (known.get(id) ?? positions.get(id))
  const ordered = relatives
    .filter((r) => positions.has(r.id))
    .sort((a, z) => depth.get(a.id)! - depth.get(z.id)!)
  for (const r of ordered) {
    let t = positions.get(r.id)!
    const lo = finalOf(r.after)
    const hi = finalOf(r.before)
    if (lo !== undefined && t <= lo) {
      t = hi !== undefined && hi > lo ? (lo + hi) / 2 : lo + step
    }
    if (hi !== undefined && t >= hi) {
      t = lo !== undefined && lo < hi ? (Math.max(lo, hi - step) + hi) / 2 : hi - step
    }
    positions.set(r.id, t)
  }

  return { positions, unresolved }
}
