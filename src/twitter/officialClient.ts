import { defaultFetcher, type Fetcher } from '../utils/fetcher.ts'
import { getMap, getSlice, getStr, isRecord } from '../utils/guards.ts'
import type { XApiTokens } from '../config/schema.ts'
import type { PostResult } from './types.ts'
import { refreshTokens } from './oauth/tokens.ts'

export const v2TweetsEndpoint = 'https://api.x.com/2/tweets'

export type OfficialXApiClientOptions = {
  tokens: XApiTokens
  fetch?: Fetcher
  now?: () => number
  onTokensRefreshed?: (tokens: XApiTokens) => Promise<void> | void
  refreshSkewMs?: number
}

export class OfficialXApiClient {
  private tokens: XApiTokens
  private readonly fetchImpl: Fetcher
  private readonly now: () => number
  private readonly onTokensRefreshed?: (tokens: XApiTokens) => Promise<void> | void
  private readonly refreshSkewMs: number

  constructor(opts: OfficialXApiClientOptions) {
    this.tokens = opts.tokens
    this.fetchImpl = opts.fetch ?? defaultFetcher
    this.now = opts.now ?? (() => Date.now())
    this.onTokensRefreshed = opts.onTokensRefreshed
    this.refreshSkewMs = opts.refreshSkewMs ?? 60_000
  }

  currentTokens(): XApiTokens {
    return this.tokens
  }

  async tweet(text: string): Promise<PostResult> {
    return this.postTweet({ text })
  }

  async reply(args: { tweetId: string; text: string }): Promise<PostResult> {
    return this.postTweet({ text: args.text, replyToTweetId: args.tweetId })
  }

  private async postTweet(args: { text: string; replyToTweetId?: string }): Promise<PostResult> {
    const body: Record<string, unknown> = { text: args.text }
    if (args.replyToTweetId) {
      body.reply = { in_reply_to_tweet_id: args.replyToTweetId }
    }
    const first = await this.request(body)
    if (first.status !== 401) {
      return interpretResponse(first.parsed, first.status, first.raw)
    }
    const refreshed = await this.tryRefresh()
    if (!refreshed.ok) {
      return { ok: false, error: refreshed.error, status: 401 }
    }
    const retry = await this.request(body)
    return interpretResponse(retry.parsed, retry.status, retry.raw)
  }

  private async request(body: Record<string, unknown>): Promise<{ parsed: unknown; status: number; raw: string }> {
    await this.ensureFreshAccessToken()
    let response: Response
    try {
      response = await this.fetchImpl(v2TweetsEndpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.tokens.accessToken}`,
          'content-type': 'application/json',
          accept: 'application/json'
        },
        body: JSON.stringify(body)
      })
    } catch (error) {
      return {
        parsed: { errors: [{ message: error instanceof Error ? error.message : 'network error' }] },
        status: 0,
        raw: ''
      }
    }
    const raw = await response.text()
    let parsed: unknown
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      parsed = undefined
    }
    return { parsed, status: response.status, raw }
  }

  private async ensureFreshAccessToken(): Promise<void> {
    if (this.tokens.expiresAt - this.now() > this.refreshSkewMs) {
      return
    }
    await this.tryRefresh()
  }

  private async tryRefresh(): Promise<{ ok: true } | { ok: false; error: string }> {
    const result = await refreshTokens({ clientId: this.tokens.clientId, refreshToken: this.tokens.refreshToken, fetch: this.fetchImpl })
    if (!result.ok) {
      return { ok: false, error: `OAuth token refresh failed: ${result.error}` }
    }
    const next: XApiTokens = {
      ...this.tokens,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresAt: this.now() + result.expiresIn * 1000,
      scope: result.scope ?? this.tokens.scope
    }
    this.tokens = next
    if (this.onTokensRefreshed) {
      await this.onTokensRefreshed(next)
    }
    return { ok: true }
  }
}

const interpretResponse = (parsed: unknown, status: number, raw: string): PostResult => {
  if (status >= 200 && status < 300 && isRecord(parsed)) {
    const tweetId = getStr(getMap(parsed, 'data'), 'id')
    if (tweetId !== '') {
      return { ok: true, tweetId }
    }
  }
  const error = firstError(parsed)
  if (error.message !== '') {
    return { ok: false, error: `X API error: ${error.message}`, code: error.code, status }
  }
  if (status === 401) {
    return { ok: false, error: 'X API rejected the access token; run `bird auth twitter` to reconnect', status }
  }
  if (status === 429) {
    return { ok: false, error: 'X API rate limit exceeded; try again later', status }
  }
  return { ok: false, error: `X API request failed with status ${status}: ${raw.slice(0, 200)}`, status }
}

const firstError = (parsed: unknown): { message: string; code?: number } => {
  if (!isRecord(parsed)) {
    return { message: '' }
  }
  const detail = getStr(parsed, 'detail')
  const title = getStr(parsed, 'title')
  if (detail !== '' || title !== '') {
    return { message: detail || title }
  }
  const errors = getSlice(parsed, 'errors')
  for (const item of errors ?? []) {
    const message = getStr(item, 'message') || getStr(item, 'detail')
    if (message === '') {
      continue
    }
    const code = isRecord(item) && typeof item.code === 'number' ? Math.trunc(item.code) : undefined
    return { message, code }
  }
  return { message: '' }
}
