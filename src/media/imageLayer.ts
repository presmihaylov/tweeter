import { readFile } from 'node:fs/promises'
import { writeSync } from 'node:fs'
import { kittyDelete, kittyDeleteAll, kittyPlace } from './kitty.ts'
import { prepareCacheKey, prepareImage, type ImageShape, type PrepareRequest } from './prepare.ts'

export type ImagePlacement = {
  key: string
  url: string
  shape: ImageShape
  col: number
  row: number
  cols: number
  rows: number
}

export type CellSize = { widthPx: number; heightPx: number }

export type ImageLayerOptions = {
  cellSize: () => CellSize
  write?: (chunk: string) => void
  prepare?: (req: PrepareRequest) => Promise<string>
  read?: (path: string) => Promise<Uint8Array>
  onReady?: () => void
}

export type ImageLayer = {
  sync(desired: ImagePlacement[]): void
  clear(): void
}

const placementSignature = (placement: ImagePlacement, path: string): string => {
  return `${path}|${placement.col}|${placement.row}|${placement.cols}|${placement.rows}`
}

// OpenTUI writes each frame straight to the file descriptor. A queued stream write
// can therefore land inside a frame and split an escape sequence, which prints the
// base64 payload as text. Push every byte out before returning.
export const writeToTerminal = (chunk: string): void => {
  const buffer = Buffer.from(chunk, 'latin1')
  let offset = 0
  while (offset < buffer.length) {
    try {
      offset += writeSync(1, buffer, offset, buffer.length - offset)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EAGAIN') {
        return
      }
    }
  }
}

export const createImageLayer = (opts: ImageLayerOptions): ImageLayer => {
  const write = opts.write ?? writeToTerminal
  const prepare = opts.prepare ?? ((req: PrepareRequest) => prepareImage(req))
  const read = opts.read ?? ((path: string) => readFile(path))
  const placed = new Map<string, { imageId: number; signature: string }>()
  const files = new Map<string, string>()
  const bytes = new Map<string, Uint8Array>()
  const pending = new Set<string>()
  const failed = new Set<string>()
  let nextImageId = 1

  const request = (placement: ImagePlacement, cell: CellSize): PrepareRequest => ({
    url: placement.url,
    shape: placement.shape,
    widthPx: placement.cols * cell.widthPx,
    heightPx: placement.rows * cell.heightPx
  })

  // Bounded so a long scroll cannot pin every decoded PNG in memory; an evicted
  // entry simply re-reads from the on-disk cache the next time it is needed.
  const retain = (cacheKey: string, path: string, png: Uint8Array): void => {
    bytes.set(path, png)
    files.set(cacheKey, path)
    for (const [key, value] of [...files]) {
      if (files.size <= 48) {
        break
      }
      files.delete(key)
      bytes.delete(value)
    }
  }

  const load = (cacheKey: string, req: PrepareRequest): void => {
    pending.add(cacheKey)
    void prepare(req)
      .then(async (path) => { retain(cacheKey, path, await read(path)) })
      .catch(() => { failed.add(cacheKey) })
      .finally(() => {
        pending.delete(cacheKey)
        opts.onReady?.()
      })
  }

  return {
    sync(desired: ImagePlacement[]) {
      const cell = opts.cellSize()
      if (cell.widthPx < 1 || cell.heightPx < 1) {
        return
      }
      const wanted = new Set(desired.map((placement) => placement.key))
      const out: string[] = []
      for (const [key, entry] of [...placed]) {
        if (!wanted.has(key)) {
          out.push(kittyDelete(entry.imageId))
          placed.delete(key)
        }
      }
      for (const placement of desired) {
        const req = request(placement, cell)
        const cacheKey = prepareCacheKey(req)
        const path = files.get(cacheKey)
        if (!path) {
          if (!pending.has(cacheKey) && !failed.has(cacheKey)) {
            load(cacheKey, req)
          }
          continue
        }
        const signature = placementSignature(placement, path)
        const current = placed.get(placement.key)
        if (current?.signature === signature) {
          continue
        }
        const png = bytes.get(path)
        if (!png) {
          continue
        }
        if (current) {
          out.push(kittyDelete(current.imageId))
        }
        const imageId = nextImageId
        nextImageId += 1
        placed.set(placement.key, { imageId, signature })
        out.push(kittyPlace(png, { imageId, col: placement.col, row: placement.row, cols: placement.cols, rows: placement.rows }))
      }
      if (out.length > 0) {
        write(out.join(''))
      }
    },
    clear() {
      placed.clear()
      write(kittyDeleteAll())
    }
  }
}
