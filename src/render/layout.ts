// render 層：事件排版
// 同一條軸線內，水平重疊的事件往下疊成多個「車道」（lane），避免糊成一團。

export interface LaneItem {
  left: number
  right: number
}

/**
 * 貪婪車道分配：項目需先依 left 排序。
 * 回傳每個項目的車道編號（0 起算），互相重疊的項目會被分到不同車道。
 */
export function assignLanes(items: LaneItem[], gap = 8): number[] {
  /** 每個車道目前佔用到的最右邊位置 */
  const laneRight: number[] = []
  return items.map((item) => {
    for (let lane = 0; lane < laneRight.length; lane++) {
      if (item.left >= laneRight[lane] + gap) {
        laneRight[lane] = item.right
        return lane
      }
    }
    laneRight.push(item.right)
    return laneRight.length - 1
  })
}

/** 粗估文字寬度（CJK 字全形、拉丁字半形），用來做碰撞排版 */
export function estimateTextWidth(text: string, fontSize = 12): number {
  let w = 0
  for (const ch of text) {
    w += (ch.codePointAt(0) ?? 0) > 0xff ? fontSize : fontSize * 0.55
  }
  return w
}

/** 截斷過長的標題（軸上空間有限，完整標題之後點開看） */
export function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? text.slice(0, maxChars) + '…' : text
}

/** 行首不該出現的標點（中文排版的「避頭」）：遇到就掛在上一行行尾 */
const NO_LINE_START = /^[，。、；：！？」』）〉》】,.;:!?)\]}…]/u

/**
 * 切成排版用的小段：英文單字、數字（含 . - ' 等）連在一起不拆；空白一段；其餘一字一段。
 * 這樣「Ryan × Righ」不會在 Righ 中間斷開，「2026/9/26」也不會拆成兩行
 */
function tokenize(text: string): string[] {
  return text.match(/[A-Za-z0-9][A-Za-z0-9.'’\-/]*|\s+|./gsu) ?? []
}

/**
 * 把文字折成幾行，每行不超過 maxW 像素（依 estimateTextWidth 估算）。
 * 英文單字不拆開、行首不放「，」「」」這類標點。
 * 超過 maxLines 行時，最後一行以「…」收尾——寧可截短也不溢出色塊。
 */
export function wrapLines(text: string, maxW: number, fontSize: number, maxLines: number): string[] {
  const lines: string[] = []
  let line = ''
  const push = () => {
    const trimmed = line.trimEnd()
    if (trimmed) lines.push(trimmed)
    line = ''
  }
  for (const token of tokenize(text)) {
    // 行首不放空白
    if (!line && /^\s+$/.test(token)) continue
    if (line && estimateTextWidth(line + token, fontSize) > maxW) {
      // 避頭標點：不讓下一行以「，」「」」開頭——把這一行最後一個字帶下去一起換行
      if (NO_LINE_START.test(token) && [...line.trimEnd()].length > 1) {
        const chars = [...line.trimEnd()]
        const carry = chars.pop()!
        line = chars.join('')
        push()
        line = carry + token
        continue
      }
      push()
      if (/^\s+$/.test(token)) continue
    }
    // 單字本身就比一行還寬（很長的網址）：只好逐字拆
    if (!line && estimateTextWidth(token, fontSize) > maxW) {
      for (const ch of token) {
        if (line && estimateTextWidth(line + ch, fontSize) > maxW) push()
        line += ch
      }
      continue
    }
    line += token
  }
  push()
  if (lines.length <= maxLines) return lines
  const kept = lines.slice(0, Math.max(1, maxLines))
  let last = kept[kept.length - 1]
  while (last && estimateTextWidth(last + '…', fontSize) > maxW) last = [...last].slice(0, -1).join('')
  kept[kept.length - 1] = last + '…'
  return kept
}
