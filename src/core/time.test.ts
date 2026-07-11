// 時間解析器的測試。所有測試案例都來自 SPEC 與真實資料（同婚／食安 Google Sheet）。
import { describe, expect, it } from 'vitest'
import { parseDateTime } from './time'

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
