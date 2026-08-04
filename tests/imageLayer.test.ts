import { describe, expect, test } from 'bun:test'
import { createImageLayer, type ImagePlacement } from '../src/media/imageLayer.ts'

const placement = (over: Partial<ImagePlacement> = {}): ImagePlacement => ({
  key: 'avatar:1',
  url: 'https://example.test/a.jpg',
  shape: 'circle',
  col: 3,
  row: 4,
  cols: 6,
  rows: 3,
  ...over
})

const harness = () => {
  const writes: string[] = []
  const prepared: string[] = []
  const layer = createImageLayer({
    cellSize: () => ({ widthPx: 10, heightPx: 20 }),
    write: (chunk) => { writes.push(chunk) },
    prepare: async (req) => {
      prepared.push(req.url)
      return `/prepared/${req.url.split('/').at(-1)}`
    },
    read: async () => new Uint8Array([9, 9, 9])
  })
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
  return { writes, prepared, layer, settle }
}

describe('image layer', () => {
  test('defers the first placement until the image is prepared', async () => {
    const { writes, prepared, layer, settle } = harness()
    layer.sync([placement()])
    expect(writes).toEqual([])
    expect(prepared).toEqual(['https://example.test/a.jpg'])

    await settle()
    layer.sync([placement()])
    expect(writes.length).toBe(1)
    expect(writes[0]).toContain('a=T,f=100,i=1,c=6,r=3')
    expect(writes[0]).toContain('\x1b[4;3H')
  })

  test('prepares each url once and skips an unchanged placement', async () => {
    const { writes, prepared, layer, settle } = harness()
    layer.sync([placement()])
    await settle()
    layer.sync([placement()])
    layer.sync([placement()])
    layer.sync([placement()])
    expect(prepared.length).toBe(1)
    expect(writes.length).toBe(1)
  })

  test('deletes the old image before re-placing a moved slot', async () => {
    const { writes, layer, settle } = harness()
    layer.sync([placement()])
    await settle()
    layer.sync([placement()])
    layer.sync([placement({ row: 9 })])
    expect(writes.length).toBe(2)
    expect(writes[1]).toContain('a=d,d=I,i=1')
    expect(writes[1]).toContain('a=T,f=100,i=2')
    expect(writes[1]).toContain('\x1b[9;3H')
  })

  test('deletes a slot that leaves the screen', async () => {
    const { writes, layer, settle } = harness()
    layer.sync([placement()])
    await settle()
    layer.sync([placement()])
    layer.sync([])
    expect(writes[1]).toBe('\x1b_Ga=d,d=I,i=1,q=2\x1b\\')
  })

  test('never retries a url whose preparation failed', async () => {
    const writes: string[] = []
    let attempts = 0
    const layer = createImageLayer({
      cellSize: () => ({ widthPx: 10, heightPx: 20 }),
      write: (chunk) => { writes.push(chunk) },
      prepare: async () => {
        attempts += 1
        throw new Error('magick missing')
      },
      read: async () => new Uint8Array()
    })
    layer.sync([placement()])
    await new Promise((resolve) => setTimeout(resolve, 0))
    layer.sync([placement()])
    layer.sync([placement()])
    expect(attempts).toBe(1)
    expect(writes).toEqual([])
  })

  test('clear removes every image', () => {
    const { writes, layer } = harness()
    layer.clear()
    expect(writes).toEqual(['\x1b_Ga=d,d=A,q=2\x1b\\'])
  })
})
