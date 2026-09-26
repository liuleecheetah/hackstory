import { describe, expect, it } from 'vitest'
import type { Layer } from '../compose/useLayers'
import type { TimelineDocument } from '../core'
import { docsToLayerIds, layerIdsToDocs, toDocKey, toLayerKey } from './studioSettings'

const layer = (id: string, docId: string): Layer => ({
  id,
  color: '#000',
  visible: true,
  doc: { hackstory: '0.5', id: docId, meta: { title: docId }, tracks: [], events: [] } as TimelineDocument,
})

// 重新整理前後，同一份文件拿到不同的圖層 id
const before = [layer('layer-0-tw-marriage', 'tw-marriage'), layer('layer-1-tw-democracy', 'tw-democracy')]
const after = [layer('layer-5-tw-democracy', 'tw-democracy'), layer('layer-6-tw-marriage', 'tw-marriage')]

describe('出圖工作室設定：用文件 id 記住，重新載入後對回目前的圖層', () => {
  it('標註事件的鍵：存的時候換成文件 id，讀回來換成新的圖層 id', () => {
    const docKey = toDocKey('layer-1-tw-democracy/evt-12', before)
    expect(docKey).toBe('tw-democracy/evt-12')
    expect(toLayerKey(docKey!, after)).toBe('layer-5-tw-democracy/evt-12')
  })

  it('圖層勾選：換成文件 id 再對回來', () => {
    const docs = layerIdsToDocs(['layer-0-tw-marriage'], before)
    expect(docs).toEqual(['tw-marriage'])
    expect(docsToLayerIds(docs, after)).toEqual(['layer-6-tw-marriage'])
  })

  it('文件已經沒載入：丟掉，不留下指向不存在圖層的設定', () => {
    expect(toLayerKey('scifi/evt-1', after)).toBeNull()
    expect(toDocKey('layer-9-gone/evt-1', before)).toBeNull()
  })
})
