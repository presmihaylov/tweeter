import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { mediaCacheDir } from '../config/paths.ts'
import type { Fetcher } from '../utils/fetcher.ts'
import { defaultFetcher } from '../utils/fetcher.ts'

export type CachedMedia = { sourceUrl: string; path: string; contentType?: string }

export const mediaCachePath = (url: string, root = mediaCacheDir()): string => {
  const hash = createHash('sha256').update(url).digest('hex')
  const parsedExt = extname(new URL(url).pathname)
  const ext = parsedExt || '.bin'
  return join(root, 'original', `${hash}${ext}`)
}

export const downloadMedia = async (url: string, opts: { fetch?: Fetcher; root?: string; maxBytes?: number } = {}): Promise<CachedMedia> => {
  const fetchImpl = opts.fetch ?? defaultFetcher
  const response = await fetchImpl(url)
  if (!response.ok) {
    throw new Error(`media download failed: HTTP ${response.status}`)
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  const maxBytes = opts.maxBytes ?? 25 * 1024 * 1024
  if (bytes.length > maxBytes) {
    throw new Error(`media too large: ${bytes.length} bytes`)
  }
  const path = mediaCachePath(url, opts.root)
  await mkdir(join(opts.root ?? mediaCacheDir(), 'original'), { recursive: true })
  await writeFile(path, bytes)
  const contentType = response.headers.get('content-type') ?? undefined
  return { sourceUrl: url, path, contentType }
}
