// adapters 層：匯出成 Markdown 大事記
// 把一份 .hst.json 轉成依時間排序、可直接貼進 HackMD／共筆／報導草稿的中文大事記。
// 定位（見 docs/share-plan.md）：Markdown 是「翻譯格式」，不是儲存格式——
// 匯出不怕資訊遺失，要完整資料的人拿 .hst.json 就好。
// 只呼叫 core；不碰畫面、不碰資料來源。

import type { AbsoluteTimePoint, HstEvent, RelativeAnchor, TimelineDocument } from '../core'
import { absolutePointRange, isAbsolute, isFeatured, resolveRelativeEvents } from '../core'

/** 關係類型的中文名稱（與介面一致） */
const REL_TYPE_LABELS: Record<string, string> = {
  causes: '導致',
  responds_to: '回應',
  derives_from: '衍生自',
  contradicts: '與之矛盾',
  same_event: '同一事件',
}

/** 查證程度的中文名稱。verified 是可信基準，不特別標註以免雜訊 */
const CONFIDENCE_LABELS: Record<string, string> = {
  reported: '報導',
  disputed: '有爭議',
  unknown: '未確認',
}

/** 原始出處類型的中文名稱 */
const SOURCE_TYPE_LABELS: Record<string, string> = {
  'google-sheet': 'Google 試算表',
  csv: 'CSV 檔案',
  json: 'JSON 檔案',
}

/** 把絕對時間點格式化成人看得懂的中文日期 */
function formatAbsolute(p: AbsoluteTimePoint): string {
  const circa = p.circa ? '約 ' : ''
  switch (p.precision) {
    case 'year':
      return `${circa}${p.value} 年`
    case 'month': {
      const [y, m] = p.value.split('-')
      return `${circa}${y} 年 ${Number(m)} 月`
    }
    case 'day': {
      const [y, m, d] = p.value.split('-')
      return `${circa}${y} 年 ${Number(m)} 月 ${Number(d)} 日`
    }
    case 'minute': {
      const [date, time] = p.value.split('T')
      const [y, m, d] = date.split('-')
      return `${circa}${y} 年 ${Number(m)} 月 ${Number(d)} 日 ${time}`
    }
  }
}

/** 事件在大事記裡顯示的「日期」文字（含區間、進行中、相對時間） */
function eventDateString(
  ev: HstEvent,
  resolved: Set<string>,
  titleOf: (id: string) => string,
): string {
  if (isAbsolute(ev.start)) {
    const startStr = formatAbsolute(ev.start)
    if (ev.end && isAbsolute(ev.end)) return `${startStr} – ${formatAbsolute(ev.end)}`
    if (ev.ongoing) return `${startStr} 起（進行中）`
    return startStr
  }
  // 相對時間：沒有真實日期，明確標示這是推估位置（SPEC 第 4 節）
  const rel = (ev.start as RelativeAnchor).relative
  const parts: string[] = []
  if (rel.after) parts.push(`在「${titleOf(rel.after)}」之後`)
  if (rel.before) parts.push(`在「${titleOf(rel.before)}」之前`)
  const suffix = resolved.has(ev.id) ? '' : '，尚無法定位'
  return `推估位置（${parts.join('、')}${suffix}）`
}

/** 排序用的毫秒鍵；相對時間用求解出的推估位置，無法定位的排到最後 */
function sortKeyOf(ev: HstEvent, positions: Map<string, number>): number {
  if (isAbsolute(ev.start)) {
    const r = absolutePointRange(ev.start)
    return (r.start + r.end) / 2
  }
  return positions.get(ev.id) ?? Number.POSITIVE_INFINITY
}

/** 把單一來源格式化成 Markdown（有網址就做成連結） */
function formatSource(s: { title?: string; url?: string }): string {
  if (s.url && s.title) return `[${s.title}](${s.url})`
  if (s.url) return `[${s.url}](${s.url})`
  return s.title ?? ''
}

/**
 * 把一份時間軸文件轉成 Markdown 大事記文字。
 * 事件依時間排序；多軸文件會在每則事件標出軸線名稱。
 */
export function documentToMarkdown(doc: TimelineDocument): string {
  const { meta } = doc
  const titleOf = (id: string) => doc.events.find((e) => e.id === id)?.title || id
  const trackTitleOf = (id: string) => doc.tracks.find((t) => t.id === id)?.title ?? id
  const showTrack = doc.tracks.length > 1

  // 相對時間求解一次，供排序與「是否已定位」判斷
  const { positions } = resolveRelativeEvents(doc)
  const resolved = new Set(positions.keys())

  // 每則事件的對外關係（只列 from，避免正反各印一次）
  const outgoing = new Map<string, string[]>()
  for (const r of doc.relations ?? []) {
    const label = REL_TYPE_LABELS[r.type] ?? r.type
    const text = `${label}「${titleOf(r.to)}」${r.label ? `（${r.label}）` : ''}`
    const list = outgoing.get(r.from)
    if (list) list.push(text)
    else outgoing.set(r.from, [text])
  }

  const lines: string[] = []

  // ---- 標題與身分資訊 ----
  lines.push(`# ${meta.title}`)
  if (meta.subtitle) {
    lines.push('')
    lines.push(`> ${meta.subtitle}`)
  }
  if (meta.description) {
    lines.push('')
    lines.push(meta.description)
  }

  const info: string[] = []
  if (meta.authors && meta.authors.length > 0) {
    info.push(
      `**作者：** ${meta.authors
        .map((a) => (a.url ? `[${a.name}](${a.url})` : a.name))
        .join('、')}`,
    )
  }
  if (meta.license) info.push(`**授權：** ${meta.license}`)
  if (meta.source) {
    const label = SOURCE_TYPE_LABELS[meta.source.type] ?? meta.source.type
    info.push(`**原始出處：** ${meta.source.url ? `[${label}](${meta.source.url})` : label}`)
  }
  if (meta.updated) info.push(`**最後更新：** ${meta.updated}`)
  if (info.length > 0) {
    lines.push('')
    lines.push(info.join('　｜　'))
  }

  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('## 大事記')

  // ---- 事件（依時間排序，穩定排序保留同時間的文件順序）----
  const ordered = doc.events
    .map((ev, i) => ({ ev, i, key: sortKeyOf(ev, positions) }))
    .sort((a, b) => a.key - b.key || a.i - b.i)

  if (ordered.length === 0) {
    lines.push('')
    lines.push('（此時間軸目前沒有事件）')
  }

  for (const { ev } of ordered) {
    const dateStr = eventDateString(ev, resolved, titleOf)
    const marker = isFeatured(ev) ? '★ ' : ''
    lines.push('')
    lines.push(`### ${dateStr}｜${marker}${ev.title || '（未命名事件）'}`)

    if (showTrack) {
      lines.push('')
      lines.push(`\`${trackTitleOf(ev.track)}\``)
    }
    if (ev.description) {
      lines.push('')
      lines.push(ev.description)
    }

    const bullets: string[] = []
    if (ev.location?.name) bullets.push(`地點：${ev.location.name}`)
    if (ev.tags && ev.tags.length > 0) bullets.push(`標籤：${ev.tags.join('、')}`)
    if (ev.confidence && CONFIDENCE_LABELS[ev.confidence]) {
      bullets.push(`查證程度：${CONFIDENCE_LABELS[ev.confidence]}`)
    }
    const rels = outgoing.get(ev.id)
    if (rels && rels.length > 0) bullets.push(`關聯：${rels.join('；')}`)
    if (ev.sources && ev.sources.length > 0) {
      const formatted = ev.sources.map(formatSource).filter((s) => s !== '')
      if (formatted.length > 0) bullets.push(`來源：${formatted.join('、')}`)
    }
    if (bullets.length > 0) {
      lines.push('')
      for (const b of bullets) lines.push(`- ${b}`)
    }
  }

  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('*本大事記由 HackStory 匯出。完整資料（含時間精度、關係線、相對時間）請見原始 `.hst.json` 檔案。*')
  lines.push('')

  return lines.join('\n')
}
