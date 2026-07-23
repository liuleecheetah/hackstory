// .hst.json 驗證器的測試。
// 「規格好不好，用真實的髒資料來檢驗」——所以第一個測試就是 examples/ 裡的真實檔案。
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { validateDocument } from './validate'

const here = dirname(fileURLToPath(import.meta.url))
const examplePath = resolve(here, '../../examples/marriage-equality.hst.json')

/** 產生一份最小的合法文件，各測試在它上面動手腳 */
function minimalDoc(): Record<string, unknown> {
  return {
    hackstory: '0.1',
    id: 'test-timeline',
    meta: { title: '測試時間軸', license: 'CC-BY-4.0' },
    tracks: [{ id: 'main', title: '主軸' }],
    events: [
      {
        id: 'evt-001',
        track: 'main',
        title: '測試事件',
        start: { value: '2017-05-24', precision: 'day' },
      },
    ],
  }
}

describe('真實資料', () => {
  it('examples/marriage-equality.hst.json（真實檔案）通過驗證且含多筆事件', () => {
    const data = JSON.parse(readFileSync(examplePath, 'utf-8'))
    const result = validateDocument(data)
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
    // 精選內容會持續增修，這裡只確保檔案有實際事件、不會被清空，
    // 不再寫死確切筆數（避免每次擴充內容都要改測試、甚至擋到部署）。
    expect(result.doc?.events.length).toBeGreaterThanOrEqual(20)
  })

  it('examples/ 目錄下每一份 .hst.json 都通過驗證', () => {
    const dir = resolve(here, '../../examples')
    const files = readdirSync(dir).filter((f) => f.endsWith('.hst.json'))
    expect(files.length).toBeGreaterThanOrEqual(3)
    for (const file of files) {
      const data = JSON.parse(readFileSync(resolve(dir, file), 'utf-8'))
      const result = validateDocument(data)
      expect(result.errors, `${file} 應通過驗證`).toEqual([])
    }
  })
})

describe('必要欄位', () => {
  it('最小合法文件通過驗證', () => {
    const result = validateDocument(minimalDoc())
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('不是物件（例如純字串）→ 錯誤', () => {
    expect(validateDocument('哈囉').ok).toBe(false)
  })

  it('缺少 hackstory 版本號 → 錯誤', () => {
    const doc = minimalDoc()
    delete doc.hackstory
    const result = validateDocument(doc)
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.path === 'hackstory')).toBe(true)
  })

  it('不支援的主版本（1.0）→ 錯誤；較新的次版本（0.9）→ 只警告不擋', () => {
    expect(validateDocument({ ...minimalDoc(), hackstory: '1.0' }).ok).toBe(false)
    const newer = validateDocument({ ...minimalDoc(), hackstory: '0.9' })
    expect(newer.ok).toBe(true)
    expect(newer.warnings.some((w) => w.path === 'hackstory')).toBe(true)
  })

  it('id 不是 slug（含中文或空白）→ 錯誤', () => {
    expect(validateDocument({ ...minimalDoc(), id: '我的 時間軸' }).ok).toBe(false)
  })

  it('缺少 meta.title → 錯誤', () => {
    const doc = minimalDoc()
    doc.meta = { license: 'CC-BY-4.0' }
    const result = validateDocument(doc)
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.path === 'meta.title')).toBe(true)
  })

  it('未標示授權 → 警告（不擋），提醒補 CC-BY-4.0', () => {
    const doc = minimalDoc()
    doc.meta = { title: '沒授權的軸' }
    const result = validateDocument(doc)
    expect(result.ok).toBe(true)
    expect(result.warnings.some((w) => w.path === 'meta.license')).toBe(true)
  })

  it('tracks 是空陣列 → 錯誤（至少一條軸線）', () => {
    expect(validateDocument({ ...minimalDoc(), tracks: [] }).ok).toBe(false)
  })
})

describe('事件與引用完整性', () => {
  it('事件指向不存在的軸線 → 錯誤', () => {
    const doc = minimalDoc()
    ;(doc.events as Record<string, unknown>[])[0].track = 'ghost'
    const result = validateDocument(doc)
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.message.includes('ghost'))).toBe(true)
  })

  it('事件 id 重複 → 錯誤（id 一旦發佈不可改，必須唯一）', () => {
    const doc = minimalDoc()
    const events = doc.events as Record<string, unknown>[]
    events.push({ ...events[0] })
    expect(validateDocument(doc).ok).toBe(false)
  })

  it('value 與 precision 不一致（2017-05-24 配 month）→ 錯誤', () => {
    const doc = minimalDoc()
    ;(doc.events as Record<string, unknown>[])[0].start = {
      value: '2017-05-24',
      precision: 'month',
    }
    expect(validateDocument(doc).ok).toBe(false)
  })

  it('value 沒補零（2010-6）→ 錯誤，格式必須是 YYYY-MM', () => {
    const doc = minimalDoc()
    ;(doc.events as Record<string, unknown>[])[0].start = { value: '2010-6', precision: 'month' }
    expect(validateDocument(doc).ok).toBe(false)
  })

  it('格式對但日期不存在（2017-02-30）→ 錯誤', () => {
    const doc = minimalDoc()
    ;(doc.events as Record<string, unknown>[])[0].start = {
      value: '2017-02-30',
      precision: 'day',
    }
    expect(validateDocument(doc).ok).toBe(false)
  })

  it('featured 不是布林 → 錯誤', () => {
    const doc = minimalDoc()
    ;(doc.events as Record<string, unknown>[])[0].featured = 'yes'
    expect(validateDocument(doc).ok).toBe(false)
  })

  it('殘留的舊欄位 importance → 通過但警告（已移除，改用 featured）', () => {
    const doc = minimalDoc()
    ;(doc.events as Record<string, unknown>[])[0].importance = 5
    const result = validateDocument(doc)
    expect(result.ok).toBe(true)
    expect(result.warnings.some((w) => w.message.includes('importance'))).toBe(true)
  })

  it('結束時間早於開始時間 → 警告（不擋，讓使用者自己看著辦）', () => {
    const doc = minimalDoc()
    const evt = (doc.events as Record<string, unknown>[])[0]
    evt.start = { value: '2017-05-24', precision: 'day' }
    evt.end = { value: '2017-05-20', precision: 'day' }
    const result = validateDocument(doc)
    expect(result.ok).toBe(true)
    expect(result.warnings.some((w) => w.message.includes('早於'))).toBe(true)
  })

  it('進行中事件（ongoing: true，SPEC 0.2）合法；同時有 end 則警告', () => {
    const doc = minimalDoc()
    const evt = (doc.events as Record<string, unknown>[])[0]
    evt.ongoing = true
    const ok = validateDocument(doc)
    expect(ok.errors).toEqual([])
    expect(ok.ok).toBe(true)
    // ongoing 不是布林 → 錯誤
    evt.ongoing = '是'
    expect(validateDocument(doc).ok).toBe(false)
    // ongoing 與 end 同時存在 → 警告（以 end 為準）
    evt.ongoing = true
    evt.end = { value: '2024-12-31', precision: 'day' }
    const both = validateDocument(doc)
    expect(both.ok).toBe(true)
    expect(both.warnings.some((w) => w.message.includes('以結束時間為準'))).toBe(true)
  })

  it('相對時間錨點（Phase 2 的前瞻設計）：格式合法就接受', () => {
    const doc = minimalDoc()
    const events = doc.events as Record<string, unknown>[]
    events.push({
      id: 'evt-002',
      track: 'main',
      title: '只知道在 evt-001 之後的事件',
      start: { relative: { after: 'evt-001' } },
    })
    const result = validateDocument(doc)
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('相對時間指向不存在的事件 → 錯誤', () => {
    const doc = minimalDoc()
    const events = doc.events as Record<string, unknown>[]
    events.push({
      id: 'evt-002',
      track: 'main',
      title: '掛在幽靈事件上的事件',
      start: { relative: { after: 'evt-999' } },
    })
    expect(validateDocument(doc).ok).toBe(false)
  })
})

describe('relations 與 display', () => {
  it('關係指向不存在的事件 → 錯誤', () => {
    const doc = minimalDoc()
    doc.relations = [{ from: 'evt-001', to: 'evt-999', type: 'causes' }]
    expect(validateDocument(doc).ok).toBe(false)
  })

  it('關係類型不在允許值中 → 錯誤', () => {
    const doc = minimalDoc()
    const events = doc.events as Record<string, unknown>[]
    events.push({ ...events[0], id: 'evt-002' })
    doc.relations = [{ from: 'evt-001', to: 'evt-002', type: 'friends_with' }]
    expect(validateDocument(doc).ok).toBe(false)
  })

  it('display.orientation 亂填 → 錯誤', () => {
    const doc = minimalDoc()
    doc.display = { orientation: 'diagonal' }
    expect(validateDocument(doc).ok).toBe(false)
  })
})

describe('向前相容（SPEC 第 10 節）', () => {
  it('不認識的欄位保留不動，不影響驗證結果', () => {
    const doc = minimalDoc()
    doc.futureFeature = { fancy: true }
    ;(doc.events as Record<string, unknown>[])[0].comments = ['未來的評論功能']
    const result = validateDocument(doc)
    expect(result.ok).toBe(true)
    // 驗證器不刪改欄位：回傳的 doc 就是原物件
    expect((result.doc as unknown as Record<string, unknown>).futureFeature).toEqual({
      fancy: true,
    })
  })
})
