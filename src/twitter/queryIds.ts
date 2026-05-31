import { existsSync } from 'node:fs'
import { z } from 'zod'
import { fallbackQueryIds, targetOperations } from './constants.ts'
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

  constructor(private readonly path = queryIdsPath(), private readonly fetchImpl: Fetcher = defaultFetcher) {}

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

  async refresh(baseUrl = 'https://x.com'): Promise<QueryIdCache> {
    const htmlResponse = await this.fetchImpl(baseUrl)
    if (!htmlResponse.ok) {
      throw new Error(`query id discovery failed: HTTP ${htmlResponse.status}`)
    }
    const html = await htmlResponse.text()
    const jsPaths = [...html.matchAll(/src=["']([^"']+\.js)["']/g)]
      .map(match => match[1])
      .filter((path): path is string => typeof path === 'string')
      .slice(0, 40)
    const operations: Record<string, string> = {}
    for (const jsPath of jsPaths) {
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
    const current = this.cache ?? await this.load()
    const next = { updatedAt: new Date().toISOString(), operations: { ...current.operations, ...operations } }
    await this.save(next)
    return next
  }
}

export const findOperationId = (source: string, operationName: string): string | undefined => {
  const escaped = operationName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const quoted = "[\"']"
  const patterns = [
    new RegExp(`queryId:\\s*${quoted}([A-Za-z0-9_-]{10,})${quoted}[^}]{0,200}operationName:\\s*${quoted}${escaped}${quoted}`),
    new RegExp(`operationName:\\s*${quoted}${escaped}${quoted}[^}]{0,200}queryId:\\s*${quoted}([A-Za-z0-9_-]{10,})${quoted}`),
    new RegExp(`${quoted}${escaped}${quoted},queryId:\\s*${quoted}([A-Za-z0-9_-]{10,})${quoted}`)
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
