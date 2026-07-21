// adapters 層測試：Markdown 大事記匯出
import { describe, expect, it } from 'vitest'
import type { TimelineDocument } from '../core'
import { documentToMarkdown } from './markdown'

/** 造一份最小合法文件，再用 patch 覆寫要測的欄位 */
function makeDoc(patch: Partial<TimelineDocument> = {}): TimelineDocument {
  return {
    hackstory: '0.2',
    id: 'test-doc',
    meta: { title: '測試時間軸', license: 'CC-BY-4.0' },
    tracks: [{ id: 'main', title: '主線', order: 1 }],
    events: [],
    ...patch,
  }
}

describe('documentToMarkdown — 標題與身分資訊', () => {
  it('輸出 H1 標題、副標、說明、作者與授權', () => {
    const md = documentToMarkdown(
      makeDoc({
        meta: {
          title: '台灣同婚立法進程',
          subtitle: '從祁家威到釋字 748',
          description: '整理 1986–2017 年的法制化過程。',
          authors: [{ name: '劉李俊達', url: 'https://g0v.tw' }],
          license: 'CC-BY-4.0',
        },
      }),
    )
    expect(md).toContain('# 台灣同婚立法進程')
    expect(md).toContain('> 從祁家威到釋字 748')
    expect(md).toContain('整理 1986–2017 年的法制化過程。')
    expect(md).toContain('**作者：** [劉李俊達](https://g0v.tw)')
    expect(md).toContain('**授權：** CC-BY-4.0')
    expect(md).toContain('## 大事記')
  })

  it('沒有事件時明確說明，不留空白', () => {
    const md = documentToMarkdown(makeDoc())
    expect(md).toContain('（此時間軸目前沒有事件）')
  })
})

describe('documentToMarkdown — 日期格式', () => {
  it('各種時間精度都轉成中文日期', () => {
    const md = documentToMarkdown(
      makeDoc({
        events: [
          { id: 'a', track: 'main', title: '年精度', start: { value: '1986', precision: 'year' } },
          { id: 'b', track: 'main', title: '月精度', start: { value: '2010-06', precision: 'month' } },
          { id: 'c', track: 'main', title: '日精度', start: { value: '2017-05-24', precision: 'day' } },
          {
            id: 'd',
            track: 'main',
            title: '分精度',
            start: { value: '2016-11-24T09:00', precision: 'minute' },
          },
        ],
      }),
    )
    expect(md).toContain('### 1986 年｜年精度')
    expect(md).toContain('### 2010 年 6 月｜月精度')
    expect(md).toContain('### 2017 年 5 月 24 日｜日精度')
    expect(md).toContain('### 2016 年 11 月 24 日 09:00｜分精度')
  })

  it('區間事件顯示起訖、進行中事件標「進行中」', () => {
    const md = documentToMarkdown(
      makeDoc({
        events: [
          {
            id: 'span',
            track: 'main',
            title: '區間',
            start: { value: '2016-11-24', precision: 'day' },
            end: { value: '2016-11-28', precision: 'day' },
          },
          {
            id: 'on',
            track: 'main',
            title: '持續',
            start: { value: '2019', precision: 'year' },
            ongoing: true,
          },
        ],
      }),
    )
    expect(md).toContain('2016 年 11 月 24 日 – 2016 年 11 月 28 日｜區間')
    expect(md).toContain('2019 年 起（進行中）｜持續')
  })
})

describe('documentToMarkdown — 事件依時間排序', () => {
  it('文件裡順序打亂，輸出仍照時間先後', () => {
    const md = documentToMarkdown(
      makeDoc({
        events: [
          { id: 'late', track: 'main', title: '後發生', start: { value: '2017', precision: 'year' } },
          { id: 'early', track: 'main', title: '先發生', start: { value: '1986', precision: 'year' } },
        ],
      }),
    )
    expect(md.indexOf('先發生')).toBeLessThan(md.indexOf('後發生'))
  })
})

describe('documentToMarkdown — 事件細節', () => {
  it('關鍵事件加星號，地點／標籤／來源列成清單', () => {
    const md = documentToMarkdown(
      makeDoc({
        events: [
          {
            id: 'x',
            track: 'main',
            title: '釋字 748',
            description: '大法官宣告違憲。',
            start: { value: '2017-05-24', precision: 'day' },
            importance: 5,
            location: { name: '司法院，台北' },
            tags: ['釋憲', '大法官'],
            confidence: 'verified',
            sources: [{ title: '解釋全文', url: 'https://example.tw/748' }],
          },
        ],
      }),
    )
    expect(md).toContain('｜★ 釋字 748')
    expect(md).toContain('大法官宣告違憲。')
    expect(md).toContain('- 地點：司法院，台北')
    expect(md).toContain('- 標籤：釋憲、大法官')
    expect(md).toContain('- 來源：[解釋全文](https://example.tw/748)')
    // verified 是可信基準，不印查證程度
    expect(md).not.toContain('查證程度')
  })

  it('非 verified 的查證程度會標註出來', () => {
    const md = documentToMarkdown(
      makeDoc({
        events: [
          {
            id: 'y',
            track: 'main',
            title: '傳聞事件',
            start: { value: '2020', precision: 'year' },
            confidence: 'disputed',
          },
        ],
      }),
    )
    expect(md).toContain('- 查證程度：有爭議')
  })

  it('多軸文件在事件標出軸線名稱；單軸不標', () => {
    const multi = documentToMarkdown(
      makeDoc({
        tracks: [
          { id: 'law', title: '立法', order: 1 },
          { id: 'move', title: '運動', order: 2 },
        ],
        events: [
          { id: 'e', track: 'law', title: '某立法', start: { value: '2017', precision: 'year' } },
        ],
      }),
    )
    expect(multi).toContain('`立法`')

    const single = documentToMarkdown(
      makeDoc({
        events: [{ id: 'e', track: 'main', title: '某事', start: { value: '2017', precision: 'year' } }],
      }),
    )
    expect(single).not.toContain('`主線`')
  })
})

describe('documentToMarkdown — 關係與相對時間', () => {
  it('對外關係以「關聯：」列出，含類型與對方標題', () => {
    const md = documentToMarkdown(
      makeDoc({
        events: [
          { id: 'from', track: 'main', title: '聲請釋憲', start: { value: '2015', precision: 'year' } },
          { id: 'to', track: 'main', title: '作成解釋', start: { value: '2017', precision: 'year' } },
        ],
        relations: [{ from: 'from', to: 'to', type: 'causes', label: '祁家威聲請' }],
      }),
    )
    expect(md).toContain('- 關聯：導致「作成解釋」（祁家威聲請）')
  })

  it('相對時間事件標示為推估位置，並列出前後參考', () => {
    const md = documentToMarkdown(
      makeDoc({
        events: [
          { id: 'a', track: 'main', title: '甲', start: { value: '2010', precision: 'year' } },
          { id: 'c', track: 'main', title: '丙', start: { value: '2014', precision: 'year' } },
          {
            id: 'b',
            track: 'main',
            title: '乙',
            start: { relative: { after: 'a', before: 'c' } },
          },
        ],
      }),
    )
    expect(md).toContain('推估位置（在「甲」之後、在「丙」之前）')
    // 推估落在甲與丙之間（用標題標記判斷順序，避免撞到推估說明裡引用的名字）
    expect(md.indexOf('｜甲')).toBeLessThan(md.indexOf('｜乙'))
    expect(md.indexOf('｜乙')).toBeLessThan(md.indexOf('｜丙'))
  })
})
