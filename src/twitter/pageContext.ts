import { parsePageContext, type PageContext } from './transactionId.ts'
import type { Fetcher } from '../utils/fetcher.ts'
import { defaultFetcher } from '../utils/fetcher.ts'

// The x.com bundle reads the verification key and the loading animations once per page load
// and keeps them for the life of that page. A TUI session is the same thing, so fetch the
// shell once and hold it. refresh() exists because X rotates the key per response, and a
// stale key is one of the few things that can make an otherwise good request look wrong.
const retryDelayMs = 60_000

export class PageContextStore {
  private context: PageContext | undefined
  private pending: Promise<PageContext | undefined> | undefined
  private failedAtMs = 0

  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: Fetcher = defaultFetcher,
    private readonly htmlHeaders?: () => HeadersInit,
    private readonly nowMs: () => number = Date.now
  ) {}

  async get(): Promise<PageContext | undefined> {
    if (this.context) {
      return this.context
    }
    // Without this gate a shell that cannot be parsed costs two extra requests on every
    // later call, so a session with stale cookies would triple its own traffic.
    if (this.failedAtMs !== 0 && this.nowMs() - this.failedAtMs < retryDelayMs) {
      return undefined
    }
    this.pending ??= this.fetchContext()
    const fetched = await this.pending
    this.pending = undefined
    this.context = fetched
    this.failedAtMs = fetched ? 0 : this.nowMs()
    return fetched
  }

  async refresh(): Promise<PageContext | undefined> {
    this.context = undefined
    this.pending = undefined
    this.failedAtMs = 0
    return this.get()
  }

  private async fetchContext(): Promise<PageContext | undefined> {
    // Only the signed-in /home shell carries the loading animations; the bare host can
    // answer with a redirect page that has none.
    for (const url of [`${this.baseUrl}/home`, this.baseUrl]) {
      try {
        const response = await this.fetchImpl(url, { headers: this.htmlHeaders?.() })
        if (!response.ok) {
          continue
        }
        const parsed = parsePageContext(await response.text())
        if (parsed) {
          return parsed
        }
      } catch {
        continue
      }
    }
    return undefined
  }
}
