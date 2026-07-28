// 時間解析器的測試。所有測試案例都來自 SPEC 與真實資料（同婚／食安 Google Sheet）。
import { describe, expect, it } from 'vitest'
import { absolutePointRange, dateFromParts, parseDateTime } from './time'

/** 方便斷言：解析必須成功並回傳 start */
function expectOk(dateRaw: string, timeRaw?: string) {
  const result = parseDateTime(dateRaw, timeRaw)
  expect(result.ok, `「${dateRaw}${timeRaw ? ' ' + timeRaw : ''}」應該要能解析`).toBe(true)
  if (!result.ok) throw new Error('unreachable')
  return result
}

describe('日期格式（來自真實資料的各種寫法）', () => {
  it('斜線不補零：「2017/5/24」→ 2017-05-24（day）', () => {
    const r = expectOk('2017/5/24')
    expect(r.start.value).toBe('2017-05-24')
    expect(r.start.precision).toBe('day')
  })

  it('斜線有補零：「2017/02/20」→ 2017-02-20（day）', () => {
    const r = expectOk('2017/02/20')
    expect(r.start.value).toBe('2017-02-20')
    expect(r.start.precision).toBe('day')
  })

  it('混用格式一律正規化：「2017/3/24」與「2017-3-24」與「2017.3.24」結果相同', () => {
    for (const raw of ['2017/3/24', '2017-3-24', '2017.3.24']) {
      const r = expectOk(raw)
      expect(r.start.value).toBe('2017-03-24')
      expect(r.start.precision).toBe('day')
    }
  })

  it('中文年月日：「2010年6月3日」→ 2010-06-03（day）', () => {
    const r = expectOk('2010年6月3日')
    expect(r.start.value).toBe('2010-06-03')
    expect(r.start.precision).toBe('day')
  })

  it('模糊到月：「2010年6月」→ 2010-06（month），不被壓扁成假精確的日期', () => {
    const r = expectOk('2010年6月')
    expect(r.start.value).toBe('2010-06')
    expect(r.start.precision).toBe('month')
  })

  it('模糊到年：「1986」與「1986年」→ 1986（year）', () => {
    for (const raw of ['1986', '1986年']) {
      const r = expectOk(raw)
      expect(r.start.value).toBe('1986')
      expect(r.start.precision).toBe('year')
    }
  })

  it('模糊到年代：「1980年代」「1980s」→ 1980（decade）', () => {
    for (const raw of ['1980年代', '1980 年代', '1980s']) {
      const r = expectOk(raw)
      expect(r.start.value).toBe('1980')
      expect(r.start.precision).toBe('decade')
    }
  })

  it('年代必須是 0 結尾：「1985年代」無法解析（不亂猜）', () => {
    const r = parseDateTime('1985年代')
    expect(r.ok).toBe(false)
  })

  it('ISO 分鐘格式直接接受：「2016-11-24T09:00」→ minute', () => {
    const r = expectOk('2016-11-24T09:00')
    expect(r.start.value).toBe('2016-11-24T09:00')
    expect(r.start.precision).toBe('minute')
  })

  it('原始輸入字串永遠保留在 raw 欄位', () => {
    const r = expectOk('2010年6月')
    expect(r.start.raw).toBe('2010年6月')
  })
})

describe('時間欄位（Start Time）', () => {
  it('「09:00-18:00」→ start 取 09:00、end 取 18:00（同日）', () => {
    const r = expectOk('2016/11/24', '09:00-18:00')
    expect(r.start.value).toBe('2016-11-24T09:00')
    expect(r.start.precision).toBe('minute')
    expect(r.end?.value).toBe('2016-11-24T18:00')
    expect(r.end?.precision).toBe('minute')
  })

  it('單一時間「13:00」→ minute 精度的單一時間點，沒有 end', () => {
    const r = expectOk('2016/12/10', '13:00')
    expect(r.start.value).toBe('2016-12-10T13:00')
    expect(r.end).toBeUndefined()
  })

  it('日期與時間寫在同一格：「2016/12/10 13:00」也接受', () => {
    const r = expectOk('2016/12/10 13:00')
    expect(r.start.value).toBe('2016-12-10T13:00')
    expect(r.start.precision).toBe('minute')
  })

  it('日期與時間區段同一格：「2016/11/24 09:00-18:00」→ start 與 end', () => {
    const r = expectOk('2016/11/24 09:00-18:00')
    expect(r.start.value).toBe('2016-11-24T09:00')
    expect(r.end?.value).toBe('2016-11-24T18:00')
  })

  it('日期只精確到月時，時間欄被忽略並產生警告（不靜默）', () => {
    const r = expectOk('2010年6月', '09:00')
    expect(r.start.value).toBe('2010-06')
    expect(r.start.precision).toBe('month')
    expect(r.warnings.length).toBeGreaterThan(0)
  })

  it('不合理的時刻（25:00）→ 解析失敗，附中文原因', () => {
    const r = parseDateTime('2016/11/24', '25:00')
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.reason).toContain('25')
  })
})

describe('無法解析與不存在的日期（絕不靜默丟棄）', () => {
  it('亂寫的日期「你好天」→ 失敗，保留原始字串與原因', () => {
    const r = parseDateTime('你好天')
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.raw).toBe('你好天')
    expect(r.reason).toContain('你好天')
  })

  it('格式對但日期不存在：「2017/02/30」→ 失敗（2 月沒有 30 日）', () => {
    const r = parseDateTime('2017/02/30')
    expect(r.ok).toBe(false)
  })

  it('閏年判斷：「2016/2/29」合法、「2017/2/29」不合法', () => {
    expect(parseDateTime('2016/2/29').ok).toBe(true)
    expect(parseDateTime('2017/2/29').ok).toBe(false)
  })

  it('月份超出範圍：「2017/13/1」→ 失敗', () => {
    const r = parseDateTime('2017/13/1')
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.reason).toContain('13')
  })

  it('空字串 → 失敗（由上層決定要略過還是待修正）', () => {
    expect(parseDateTime('').ok).toBe(false)
    expect(parseDateTime('   ').ok).toBe(false)
  })
})

describe('absolutePointRange — 年代誠實涵蓋整整十年', () => {
  it('1980 年代 → 1980-01-01 至 1990-01-01（不假裝知道是哪一年）', () => {
    const r = absolutePointRange({ value: '1980', precision: 'decade' })
    expect(new Date(r.start).getFullYear()).toBe(1980)
    expect(new Date(r.end).getFullYear()).toBe(1990)
  })

  it('年代的跨度是「年」的十倍', () => {
    const decade = absolutePointRange({ value: '1980', precision: 'decade' })
    const year = absolutePointRange({ value: '1980', precision: 'year' })
    const span = (x: { start: number; end: number }) => x.end - x.start
    // 兩者都從 1980-01-01 起算，年代結束於 1990、年結束於 1981
    expect(decade.start).toBe(year.start)
    expect(span(decade)).toBeGreaterThan(span(year) * 9)
  })
})

describe('古代年份（0–99）不被 JavaScript 悄悄改成 1900 年代', () => {
  it('dateFromParts(90) → 西元 90 年，不是 1990 年', () => {
    expect(dateFromParts(90).getFullYear()).toBe(90)
    // 對照：JavaScript 原生的陷阱
    expect(new Date(90, 0, 1).getFullYear()).toBe(1990)
  })

  it('一般年份行為完全不變', () => {
    expect(dateFromParts(2017, 4, 24).getFullYear()).toBe(2017)
    expect(dateFromParts(2017, 4, 24).getMonth()).toBe(4)
    expect(dateFromParts(2017, 4, 24).getDate()).toBe(24)
  })

  it('月份溢位（第 13 個月）仍正確跨到下一年', () => {
    // monthIndex 12 = 隔年一月
    expect(dateFromParts(90, 12).getFullYear()).toBe(91)
    expect(dateFromParts(90, 12).getMonth()).toBe(0)
  })

  it('日期溢位（12/32）仍正確跨到下一年', () => {
    const d = dateFromParts(90, 11, 32)
    expect(d.getFullYear()).toBe(91)
    expect(d.getMonth()).toBe(0)
    expect(d.getDate()).toBe(1)
  })

  it('閏年判斷與加 2000 年前後一致（西元 4 年是閏年）', () => {
    // 2 月 29 日存在 → 不會被推到 3 月 1 日
    const d = dateFromParts(4, 1, 29)
    expect(d.getFullYear()).toBe(4)
    expect(d.getMonth()).toBe(1)
    expect(d.getDate()).toBe(29)
  })

  it('absolutePointRange：「0090」年落在西元 90 年，且整年涵蓋 90→91', () => {
    const r = absolutePointRange({ value: '0090', precision: 'year' })
    expect(new Date(r.start).getFullYear()).toBe(90)
    expect(new Date(r.end).getFullYear()).toBe(91)
  })

  it('absolutePointRange：「0090-06-15」日精度也正確', () => {
    const r = absolutePointRange({ value: '0090-06-15', precision: 'day' })
    const start = new Date(r.start)
    expect(start.getFullYear()).toBe(90)
    expect(start.getMonth()).toBe(5)
    expect(start.getDate()).toBe(15)
  })

  it('「0090」能被解析，且不變成 1990', () => {
    const r = parseDateTime('0090')
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('unreachable')
    expect(r.start.value).toBe('0090')
    expect(new Date(absolutePointRange(r.start).start).getFullYear()).toBe(90)
  })
})
