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

  it('end 用相對時間 → 錯誤（畫不出來，不能讓它被靜默畫成點事件）', () => {
    const doc = minimalDoc()
    const events = doc.events as Record<string, unknown>[]
    events.push({ ...events[0], id: 'evt-002' })
    events[0].end = { relative: { before: 'evt-002' } }
    const result = validateDocument(doc)
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.message.includes('結束時間不支援相對時間'))).toBe(true)
  })

  it('start 用相對時間仍然合法（只有 end 被限制）', () => {
    const doc = minimalDoc()
    const events = doc.events as Record<string, unknown>[]
    events.push({ ...events[0], id: 'evt-002' })
    events[0].start = { relative: { before: 'evt-002' } }
    expect(validateDocument(doc).errors).toEqual([])
  })

  it('年代精度：1980 合法，1985 錯誤（年代必須是 0 結尾）', () => {
    const ok = minimalDoc()
    ;(ok.events as Record<string, unknown>[])[0].start = { value: '1980', precision: 'decade' }
    expect(validateDocument(ok).errors).toEqual([])

    const bad = minimalDoc()
    ;(bad.events as Record<string, unknown>[])[0].start = { value: '1985', precision: 'decade' }
    expect(validateDocument(bad).ok).toBe(false)
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

  it('關係 id 重複 → 錯誤（Phase 2 靠它指認同一條關係）', () => {
    const doc = minimalDoc()
    const events = doc.events as Record<string, unknown>[]
    events.push({ ...events[0], id: 'evt-002' })
    doc.relations = [
      { id: 'rel-1', from: 'evt-001', to: 'evt-002', type: 'causes' },
      { id: 'rel-1', from: 'evt-002', to: 'evt-001', type: 'responds_to' },
    ]
    expect(validateDocument(doc).ok).toBe(false)
  })

  it('關係 id 不重複 → 通過', () => {
    const doc = minimalDoc()
    const events = doc.events as Record<string, unknown>[]
    events.push({ ...events[0], id: 'evt-002' })
    doc.relations = [{ id: 'rel-1', from: 'evt-001', to: 'evt-002', type: 'causes' }]
    expect(validateDocument(doc).errors).toEqual([])
  })

  it('跨文件關係（toDoc）：不因為本文件找不到該事件而報錯，但會提醒尚未實作', () => {
    const doc = minimalDoc()
    doc.relations = [
      { from: 'evt-001', to: 'evt-777', toDoc: 'other-timeline', type: 'same_event' },
    ]
    const result = validateDocument(doc)
    expect(result.errors).toEqual([])
    expect(result.warnings.some((w) => w.message.includes('跨文件'))).toBe(true)
  })

  it('關係的 label 不是字串 → 錯誤', () => {
    const doc = minimalDoc()
    const events = doc.events as Record<string, unknown>[]
    events.push({ ...events[0], id: 'evt-002' })
    doc.relations = [{ from: 'evt-001', to: 'evt-002', type: 'causes', label: 123 }]
    expect(validateDocument(doc).ok).toBe(false)
  })

  it('display.orientation 亂填 → 錯誤', () => {
    const doc = minimalDoc()
    doc.display = { orientation: 'diagonal' }
    expect(validateDocument(doc).ok).toBe(false)
  })

  it('display.range 不是物件、或缺 start／end → 錯誤', () => {
    const notObject = minimalDoc()
    notObject.display = { range: '1986-2017' }
    expect(validateDocument(notObject).ok).toBe(false)

    const missingEnd = minimalDoc()
    missingEnd.display = { range: { start: '1986' } }
    expect(validateDocument(missingEnd).ok).toBe(false)
  })

  it('display.range 不是四位數年份 → 通過但警告（會被忽略）', () => {
    const doc = minimalDoc()
    doc.display = { range: { start: '1986/3', end: '2017' } }
    const result = validateDocument(doc)
    expect(result.ok).toBe(true)
    expect(result.warnings.some((w) => w.message.includes('四位數年份'))).toBe(true)
  })
})

describe('內容型別的深入檢查（不只檢查是不是陣列／物件）', () => {
  it('meta.topics 裡混入非字串 → 錯誤', () => {
    const doc = minimalDoc()
    ;(doc.meta as Record<string, unknown>).topics = ['人權', 42]
    expect(validateDocument(doc).ok).toBe(false)
  })

  it('tags 裡混入非字串 → 錯誤', () => {
    const doc = minimalDoc()
    ;(doc.events as Record<string, unknown>[])[0].tags = ['釋憲', { x: 1 }]
    expect(validateDocument(doc).ok).toBe(false)
  })

  it('sources 的 title／url 不是字串 → 錯誤', () => {
    const doc = minimalDoc()
    ;(doc.events as Record<string, unknown>[])[0].sources = [{ title: '解釋文', url: 123 }]
    expect(validateDocument(doc).ok).toBe(false)
  })

  it('sources 既沒 title 也沒 url → 通過但警告（無法追溯）', () => {
    const doc = minimalDoc()
    ;(doc.events as Record<string, unknown>[])[0].sources = [{}]
    const result = validateDocument(doc)
    expect(result.ok).toBe(true)
    expect(result.warnings.some((w) => w.message.includes('無法追溯'))).toBe(true)
  })

  it('location 的 lat／lng 不是數字或超出範圍 → 錯誤', () => {
    const notNumber = minimalDoc()
    ;(notNumber.events as Record<string, unknown>[])[0].location = { name: '台北', lat: '25.03' }
    expect(validateDocument(notNumber).ok).toBe(false)

    const outOfRange = minimalDoc()
    ;(outOfRange.events as Record<string, unknown>[])[0].location = {
      name: '台北',
      lat: 25.03,
      lng: 999,
    }
    expect(validateDocument(outOfRange).ok).toBe(false)
  })

  it('合理的經緯度 → 通過（預留給未來地圖功能）', () => {
    const doc = minimalDoc()
    ;(doc.events as Record<string, unknown>[])[0].location = {
      name: '司法院，台北',
      lat: 25.0375,
      lng: 121.5637,
    }
    expect(validateDocument(doc).errors).toEqual([])
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
