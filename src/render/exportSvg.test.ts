import { describe, expect, it } from 'vitest'
import type { ExportRequestBase } from './exportSvg'
import { renderWithAutoHeight } from './exportSvg'

const req = { width: 620, height: 877 } as ExportRequestBase

describe('renderWithAutoHeight：自動長度', () => {
  it('先試算需要多高，再用那個高度正式畫一次', async () => {
    const heights: number[] = []
    const render = async (r: ExportRequestBase) => {
      heights.push(r.height)
      return { contentHeight: 2345.2 }
    }
    const out = await renderWithAutoHeight(render, req, 50_000)
    expect(heights).toEqual([50_000, 2346])
    expect(out.height).toBe(2346)
  })

  it('內容很少時不會縮成細長條', async () => {
    const out = await renderWithAutoHeight(async () => ({ contentHeight: 120 }), req, 600)
    expect(out.height).toBe(360)
  })
})
