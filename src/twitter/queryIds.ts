import { existsSync } from 'node:fs'
import { z } from 'zod'
import { fallbackQueryIds, lazyChunkOperations, targetOperations } from './constants.ts'
import { queryIdsPath } from '../config/paths.ts'
import { readJsonFile, writeJsonFile } from '../utils/fs.ts'
import type { Fetcher } from '../utils/fetcher.ts'
import { defaultFetcher } from '../utils/fetcher.ts'

const queryIdCacheSchema = z.object({
  updatedAt: z.string(),
  operations: z.record(z.string(), z.string())
})

type QueryIdCache = z.infer<typeof queryIdCacheSchema>

export class QueryIdStore {
  private cache: QueryIdCache | undefined

  constructor(
    private readonly path = queryIdsPath(),
    private readonly fetchImpl: Fetcher = defaultFetcher,
    private readonly htmlHeaders?: () => HeadersInit
  ) {}

  async load(): Promise<QueryIdCache> {
    if (!existsSync(this.path)) {
      this.cache = { updatedAt: new Date(0).toISOString(), operations: {} }
      return this.cache
    }
    const parsed = queryIdCacheSchema.safeParse(await readJsonFile(this.path))
    if (!parsed.success) {
      this.cache = { updatedAt: new Date(0).toISOString(), operations: {} }
      return this.cache
    }
    this.cache = parsed.data
    return parsed.data
  }

  async save(cache: QueryIdCache): Promise<void> {
    this.cache = cache
    await writeJsonFile(this.path, cache)
  }

  async get(operationName: string): Promise<string> {
    const cache = this.cache ?? await this.load()
    return cache.operations[operationName] ?? fallbackQueryIds[operationName] ?? ''
  }

  // The logged-out shell links one loader script and no query ids. Only the signed-in
  // /home page links the vendor and main bundles that carry them, so ask for that first.
  private async fetchShell(baseUrl: string): Promise<string> {
    const urls = [`${baseUrl}/home`, baseUrl]
    for (const url of urls) {
      const response = await this.fetchImpl(url, { headers: this.htmlHeaders?.() })
      if (!response.ok) {
        continue
      }
      const html = await response.text()
      if (/src=["'][^"']+\.js["']/.test(html)) {
        return html
      }
    }
    throw new Error('query id discovery failed: no script bundles in the x.com shell')
  }

  async refresh(baseUrl = 'https://x.com'): Promise<QueryIdCache> {
    const html = await this.fetchShell(baseUrl)
    const jsPaths = [...html.matchAll(/src=["']([^"']+\.js)["']/g)]
      .map(match => match[1])
      .filter((path): path is string => typeof path === 'string')
      // The ad script is on the page too, and it can never hold a query id.
      .filter((path) => path.includes('twimg.com') || !path.startsWith('http'))
      .slice(0, 40)
    const operations: Record<string, string> = {}
    for (const jsPath of jsPaths) {
      if (Object.keys(operations).length === targetOperations.length) {
        break
      }
      const url = jsPath.startsWith('http') ? jsPath : new URL(jsPath, baseUrl).toString()
      const response = await this.fetchImpl(url)
      if (!response.ok) {
        continue
      }
      const source = await response.text()
      for (const operation of targetOperations) {
        const found = findOperationId(source, operation)
        if (found) {
          operations[operation] = found
        }
      }
    }
    for (const [operation, chunk] of Object.entries(lazyChunkOperations)) {
      if (operations[operation] !== undefined) {
        continue
      }
      const found = await this.scanChunk(html, chunk, operation)
      if (found) {
        operations[operation] = found
      }
    }
    const current = this.cache ?? await this.load()
    const next = { updatedAt: new Date().toISOString(), operations: { ...current.operations, ...operations } }
    await this.save(next)
    return next
  }

  private async scanChunk(html: string, chunkName: string, operation: string): Promise<string | undefined> {
    const url = chunkUrlOf(html, chunkName)
    if (url === undefined) {
      return undefined
    }
    const response = await this.fetchImpl(url)
    if (!response.ok) {
      return undefined
    }
    return findOperationId(await response.text(), operation)
  }
}

// The shell holds the whole webpack loader inline. Its chunk-file builder is one expression:
// a map of chunk id to name, a map of chunk id to hash, and the public path beside them. A
// chunk nobody links can still be named from those three.
export const chunkUrlOf = (html: string, chunkName: string): string | undefined => {
  const builder = /\.u=\w+=>""\+\(\((\{[^)]*?\})\)\[\w+\]\|\|\w+\)\+"\."\+\((\{[^)]*?\})\)\[\w+\]\+"a\.js"/.exec(html)
  const base = /\.p="(https:\/\/[^"]+\/)"/.exec(html)?.[1]
  if (!builder || base === undefined) {
    return undefined
  }
  const chunkId = entriesOf(builder[1] ?? '').find(([, name]) => name === chunkName)?.[0]
  const hash = chunkId === undefined ? undefined : entriesOf(builder[2] ?? '').find(([id]) => id === chunkId)?.[1]
  if (hash === undefined) {
    return undefined
  }
  return `${base}${chunkName}.${hash}a.js`
}

const entriesOf = (source: string): [string, string][] =>
  [...source.matchAll(/(\d+):"([^"]*)"/g)].map((match) => [match[1] ?? '', match[2] ?? ''])

export const findOperationId = (source: string, operationName: string): string | undefined => {
  const escaped = operationName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const quoted = "[\"']"
  const patterns = [
    new RegExp(`queryId:\\s*${quoted}([A-Za-z0-9_-]{10,})${quoted}[^}]{0,200}operationName:\\s*${quoted}${escaped}${quoted}`),
    new RegExp(`operationName:\\s*${quoted}${escaped}${quoted}[^}]{0,200}queryId:\\s*${quoted}([A-Za-z0-9_-]{10,})${quoted}`),
    new RegExp(`${quoted}${escaped}${quoted},queryId:\\s*${quoted}([A-Za-z0-9_-]{10,})${quoted}`),
    // The analytics page is a Relay app, and Relay names the same two things differently:
    // the id is `id` and the operation is `name`, inside the compiled query's params block.
    new RegExp(`params:\\{id:${quoted}([A-Za-z0-9_-]{10,})${quoted},metadata:\\{[^}]*\\},name:${quoted}${escaped}${quoted}`)
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(source)
    const id = match?.[1]
    if (id) {
      return id
    }
  }
  return undefined
}
