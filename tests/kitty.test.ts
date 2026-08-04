import { describe, expect, test } from 'bun:test'
import { chunkBase64, kittyDelete, kittyDeleteAll, kittyPlace, moveCursor } from '../src/media/kitty.ts'
import { cellSize, fitCells, parseCellOverride } from '../src/media/geometry.ts'
import { magickArgs, prepareCacheKey, preparedPath } from '../src/media/prepare.ts'
import { detectImageRenderer } from '../src/media/detect.ts'

describe('kitty encoder', () => {
  test('splits a payload into 4096 byte chunks', () => {
    expect(chunkBase64('a'.repeat(9000)).map((chunk) => chunk.length)).toEqual([4096, 4096, 808])
    expect(chunkBase64('')).toEqual([''])
  })

  test('moves the cursor with 1-based row and column', () => {
    expect(moveCursor(7, 3)).toBe('\x1b[3;7H')
  })

  test('places a single-chunk image with the placement rectangle', () => {
    const png = new Uint8Array([1, 2, 3, 4])
    const out = kittyPlace(png, { imageId: 9, col: 4, row: 2, cols: 6, rows: 3 })
    expect(out).toBe(`\x1b7\x1b[2;4H\x1b_Ga=T,f=100,i=9,c=6,r=3,C=1,q=2,m=0;${Buffer.from(png).toString('base64')}\x1b\\\x1b8`)
  })

  test('carries the control keys on the first chunk only', () => {
    const out = kittyPlace(new Uint8Array(6000), { imageId: 1, col: 1, row: 1, cols: 2, rows: 2 })
    const headers = out.split('\x1b_G').slice(1).map((part) => part.slice(0, part.indexOf(';')))
    expect(headers.length).toBe(2)
    expect(headers[0]).toBe('a=T,f=100,i=1,c=2,r=2,C=1,q=2,m=1')
    expect(headers[1]).toBe('m=0')
  })

  test('deletes by id and in bulk', () => {
    expect(kittyDelete(5)).toBe('\x1b_Ga=d,d=I,i=5,q=2\x1b\\')
    expect(kittyDeleteAll()).toBe('\x1b_Ga=d,d=A,q=2\x1b\\')
  })
})

describe('cell geometry', () => {
  test('derives the cell size from the reported pixel resolution', () => {
    expect(cellSize({ width: 1600, height: 960 }, 160, 48)).toEqual({ widthPx: 10, heightPx: 20 })
  })

  test('falls back when the terminal reports no pixel size', () => {
    expect(cellSize(null, 160, 48)).toEqual({ widthPx: 20, heightPx: 44 })
    expect(cellSize({ width: 0, height: 0 }, 160, 48)).toEqual({ widthPx: 20, heightPx: 44 })
  })

  test('an override wins over the reported resolution', () => {
    expect(cellSize({ width: 1600, height: 960 }, 160, 48, '19x44')).toEqual({ widthPx: 19, heightPx: 44 })
    expect(parseCellOverride('  12 x 26 ')).toEqual({ widthPx: 12, heightPx: 26 })
    expect(parseCellOverride('0x26')).toBeUndefined()
    expect(parseCellOverride('nonsense')).toBeUndefined()
    expect(parseCellOverride(undefined)).toBeUndefined()
  })

  test('shrinks a wide image to the matching row count', () => {
    const fit = fitCells(2048, 1024, 40, 20, { widthPx: 10, heightPx: 20 })
    expect(fit).toEqual({ cols: 40, rows: 10 })
  })

  test('shrinks a tall image to the matching column count', () => {
    const fit = fitCells(1000, 4000, 40, 20, { widthPx: 10, heightPx: 20 })
    expect(fit).toEqual({ cols: 10, rows: 20 })
  })

  test('keeps the full box when the image size is unknown', () => {
    expect(fitCells(0, 0, 6, 3, { widthPx: 10, heightPx: 20 })).toEqual({ cols: 6, rows: 3 })
  })
})

describe('renderer detection', () => {
  const withEnv = <T>(env: Record<string, string | undefined>, run: () => T): T => {
    const saved = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]))
    Object.assign(process.env, env)
    try {
      return run()
    } finally {
      Object.assign(process.env, saved)
    }
  }

  test('an explicit request wins over everything', () => {
    expect(withEnv({ TWEETER_IMAGE_RENDERER: 'none' }, () => detectImageRenderer('kitty'))).toBe('kitty')
  })

  test('the env var wins over terminal sniffing', () => {
    expect(withEnv({ TWEETER_IMAGE_RENDERER: 'none', TERM_PROGRAM: 'ghostty' }, () => detectImageRenderer())).toBe('none')
    expect(withEnv({ TWEETER_IMAGE_RENDERER: 'bogus', TERM: 'xterm-ghostty', TERM_PROGRAM: '' }, () => detectImageRenderer())).toBe('kitty')
  })

  test('sniffs ghostty and kitty from the terminal', () => {
    expect(withEnv({ TWEETER_IMAGE_RENDERER: '', TERM: 'xterm-kitty', TERM_PROGRAM: '' }, () => detectImageRenderer())).toBe('kitty')
    expect(withEnv({ TWEETER_IMAGE_RENDERER: '', TERM: 'xterm-256color', TERM_PROGRAM: '' }, () => detectImageRenderer())).toBe('chafa')
  })
})

describe('image preparation', () => {
  test('keys the cache on url, shape and pixel size', () => {
    const base = { url: 'https://example.test/a.jpg', shape: 'circle' as const, widthPx: 60, heightPx: 60 }
    expect(prepareCacheKey(base)).toBe(prepareCacheKey({ ...base }))
    expect(prepareCacheKey(base)).not.toBe(prepareCacheKey({ ...base, shape: 'rect' }))
    expect(prepareCacheKey(base)).not.toBe(prepareCacheKey({ ...base, widthPx: 61 }))
    expect(preparedPath(base, '/cache')).toBe(`/cache/prepared/${prepareCacheKey(base)}.png`)
  })

  test('masks avatars into a circle and pads media to the exact rectangle', () => {
    const circle = magickArgs('/in.jpg', '/out.png', { url: 'x', shape: 'circle', widthPx: 60, heightPx: 60 })
    expect(circle).toContain('circle 29.5,29.5 29.5,-0.5')
    expect(circle).toContain('DstIn')
    expect(circle.at(-1)).toBe('PNG32:/out.png')

    const rect = magickArgs('/in.jpg', '/out.png', { url: 'x', shape: 'rect', widthPx: 400, heightPx: 200 })
    expect(rect).not.toContain('DstIn')
    expect(rect).toContain('400x200')
  })
})
