import { createTweetQueryId, defaultBaseUrl, defaultGraphQLBase, defaultUserAgent, tweetDetailQueryIdFallbacks } from './constants.ts'
import { buildArticleFieldToggles, buildHomeTimelineFeatures, buildTweetCreateFeatures, buildTweetDetailFeatures } from './features.ts'
import { GraphQLClient } from './graphql.ts'
import { HeaderBuilder } from './headers.ts'
import { QueryIdStore } from './queryIds.ts'
import type { AuthStatus, ConversationPage, PostResult, TimelinePage, TweetBundle, TwitterClientOptions } from './types.ts'
import { extractCursorFromInstructions, getHomeInstructions, getTweetDetailInstructions, parseTweetsFromInstructions } from './extract/index.ts'
import { getMap, getSlice, getStr, isRecord } from '../utils/guards.ts'
import { errorMessage } from '../utils/result.ts'
import type { Fetcher } from '../utils/fetcher.ts'
import { defaultFetcher } from '../utils/fetcher.ts'
import type { DebugLogger } from '../utils/debugLog.ts'
import { safeJsonSnippet } from '../utils/debugLog.ts'

export class TwitterClient {
  private readonly baseUrl: string
  private readonly headers: HeaderBuilder
  private readonly gql: GraphQLClient
  private readonly createTweetGql: GraphQLClient
  private readonly queryIds: QueryIdStore
  private readonly fetchImpl: Fetcher
  private readonly debugLogger?: DebugLogger

  constructor(opts: TwitterClientOptions) {
    this.baseUrl = opts.baseUrl ?? defaultBaseUrl
    this.fetchImpl = opts.fetch ?? defaultFetcher
    this.debugLogger = opts.debugLogger
    this.headers = new HeaderBuilder({
      authToken: opts.authToken,
      ct0: opts.ct0,
      userAgent: opts.userAgent ?? defaultUserAgent,
      cookieHeader: opts.cookieHeader
    })
    this.queryIds = new QueryIdStore(opts.queryIdPath, this.fetchImpl)
    this.gql = new GraphQLClient(opts.graphQLBase ?? defaultGraphQLBase, this.headers, this.fetchImpl)
    this.createTweetGql = new GraphQLClient('https://twitter.com/i/api/graphql', this.headers, this.fetchImpl)
  }

  async checkAuth(): Promise<AuthStatus> {
    const endpoints = [
      `${this.baseUrl}/i/api/account/settings.json`,
      'https://api.twitter.com/1.1/account/settings.json',
      `${this.baseUrl}/i/api/account/verify_credentials.json?skip_status=true&include_entities=false`,
      'https://api.twitter.com/1.1/account/verify_credentials.json?skip_status=true&include_entities=false'
    ]
    for (const endpoint of endpoints) {
      try {
        const response = await this.fetchImpl(endpoint, { method: 'GET', headers: this.headers.jsonHeaders() })
        if (response.status === 401 || response.status === 403) {
          return { ok: false, status: response.status, error: 'X cookies rejected; refresh auth_token and ct0' }
        }
        if (!response.ok) {
          continue
        }
        const text = await response.text()
        const parsed = parseCurrentUser(text)
        if (parsed.ok) {
          if (parsed.userId) {
            this.headers.setClientUserId(parsed.userId)
          }
          return parsed
        }
      } catch {
        continue
      }
    }
    return { ok: false, error: 'could not verify X credentials' }
  }

  async loadHomeTimelinePage(args: { count: number; following: boolean; cursor?: string }): Promise<TimelinePage> {
    const operationName = args.following ? 'HomeLatestTimeline' : 'HomeTimeline'
    const variables: Record<string, unknown> = {
      count: args.count,
      includePromotedContent: true,
      latestControlAvailable: true,
      requestContext: args.cursor ? 'scroll' : 'launch',
      withCommunity: true
    }
    if (args.cursor) {
      variables.cursor = args.cursor
    }
    const body = await this.withQueryIdRetry(operationName, [], async (queryId) => {
      return this.gql.get(operationName, queryId, variables, buildHomeTimelineFeatures())
    })
    const instructions = getHomeInstructions(body)
    return {
      tweets: parseTweetsFromInstructions(instructions),
      topCursor: extractCursorFromInstructions(instructions, 'Top'),
      bottomCursor: extractCursorFromInstructions(instructions, 'Bottom')
    }
  }

  async getTweet(tweetId: string): Promise<TweetBundle> {
    const body = await this.tweetDetailRequest(tweetId)
    const instructions = getTweetDetailInstructions(body)
    const tweets = parseTweetsFromInstructions(instructions)
    const tweet = tweets.find((candidate) => candidate.id === tweetId) ?? tweets[0]
    if (!tweet) {
      throw new Error('tweet not found in response')
    }
    return { tweet, related: tweets.filter((candidate) => candidate.id !== tweet.id) }
  }

  async loadRepliesPage(args: { tweetId: string; cursor?: string }): Promise<ConversationPage> {
    const body = await this.tweetDetailRequest(args.tweetId, args.cursor)
    const instructions = getTweetDetailInstructions(body)
    const replies = parseTweetsFromInstructions(instructions).filter((tweet) => tweet.id !== args.tweetId)
    return {
      tweetId: args.tweetId,
      replies,
      cursor: extractCursorFromInstructions(instructions, 'Bottom')
    }
  }

  async reply(args: { tweetId: string; text: string }): Promise<PostResult> {
    return this.createTweet({ text: args.text, replyToTweetId: args.tweetId })
  }

  async tweet(text: string): Promise<PostResult> {
    return this.createTweet({ text })
  }

  private async tweetDetailRequest(tweetId: string, cursor?: string): Promise<unknown> {
    const variables: Record<string, unknown> = {
      focalTweetId: tweetId,
      rankingMode: 'Relevance',
      withCommunity: true,
      includePromotedContent: true,
      withBirdwatchNotes: true,
      withQuickPromoteEligibilityTweetFields: true,
      with_rux_injections: false,
      withVoice: true
    }
    if (cursor) {
      variables.cursor = cursor
    }
    return this.withQueryIdRetry('TweetDetail', [...tweetDetailQueryIdFallbacks], async (queryId) => {
      return this.gql.getThenPost('TweetDetail', queryId, variables, buildTweetDetailFeatures(), buildArticleFieldToggles())
    })
  }

  private async createTweet(args: { text: string; replyToTweetId?: string }): Promise<PostResult> {
    const media = { media_entities: [], possibly_sensitive: false }
    const variables: Record<string, unknown> = {
      tweet_text: args.text,
      dark_request: false,
      batch_compose: 'BatchSubsequent',
      media,
      semantic_annotation_ids: [],
      disallowed_reply_options: null,
      semantic_annotation_options: { source: 'Profile' }
    }
    if (args.replyToTweetId) {
      variables.reply = { in_reply_to_tweet_id: args.replyToTweetId, exclude_reply_user_ids: [] }
    }
    try {
      await this.logDebug('reply.createTweet.start', {
        isReply: Boolean(args.replyToTweetId),
        replyToTweetId: args.replyToTweetId,
        textLength: args.text.length
      })
      let lastFailure: PostResult | undefined
      for (const strategy of createTweetHeaderStrategies(this.headers)) {
        const { body, status, queryId } = await this.withCreateTweetQueryIdRetry(async (candidateQueryId) => {
          return this.createTweetGql.post(
            'CreateTweet',
            candidateQueryId,
            variables,
            buildTweetCreateFeatures(),
            {},
            strategy.headers
          )
        })
        await this.logDebug('reply.createTweet.response', {
          status,
          queryId,
          strategy: strategy.name,
          body: safeJsonSnippet(body)
        })
        const tweetId = getStr(getMap(getMap(getMap(body, 'data'), 'create_tweet'), 'tweet_results')?.result, 'rest_id')
        if (tweetId !== '') {
          return { ok: true, tweetId }
        }
        const error = firstError(body)
        if (error.message !== '') {
          const message = `CreateTweet failed${error.code ? ` (code ${error.code})` : ''}: ${error.message}`
          await this.logDebug('reply.createTweet.failure', { status, queryId, strategy: strategy.name, message, body: safeJsonSnippet(body) })
          lastFailure = { ok: false, error: message, code: error.code, status }
          if (error.code === 344 || error.code === 226) {
            continue
          }
          return lastFailure
        }
        if (status === 401 || status === 403) {
          const message = 'CreateTweet failed: X rejected the saved cookies; refresh auth_token and ct0'
          await this.logDebug('reply.createTweet.failure', { status, queryId, strategy: strategy.name, message, body: safeJsonSnippet(body) })
          return { ok: false, error: message, status }
        }
        const message = `CreateTweet returned HTTP ${status} but no tweet ID; body=${safeJsonSnippet(body, 500)}`
        await this.logDebug('reply.createTweet.failure', { status, queryId, strategy: strategy.name, message, body: safeJsonSnippet(body) })
        return { ok: false, error: message, status }
      }
      return lastFailure ?? { ok: false, error: 'CreateTweet failed before receiving a response' }
    } catch (error) {
      const message = `request error: ${errorMessage(error)}`
      await this.logDebug('reply.createTweet.exception', { message })
      return { ok: false, error: message }
    }
  }

  private async withCreateTweetQueryIdRetry(call: (queryId: string) => Promise<{ body: unknown; status: number }>): Promise<{ body: unknown; status: number; queryId: string }> {
    const cached = await this.queryIds.get('CreateTweet')
    const candidates = [...new Set([createTweetQueryId, cached].filter((id) => id !== ''))]
    for (const candidate of candidates) {
      const { body, status } = await call(candidate)
      await this.logDebug('reply.createTweet.queryIdAttempt', { queryId: candidate, status })
      if (status !== 404) {
        return { body, status, queryId: candidate }
      }
    }
    try {
      await this.queryIds.refresh(this.baseUrl)
      const refreshed = await this.queryIds.get('CreateTweet')
      if (refreshed !== '' && !candidates.includes(refreshed)) {
        const { body, status } = await call(refreshed)
        await this.logDebug('reply.createTweet.queryIdAttempt', { queryId: refreshed, status })
        if (status !== 404) {
          return { body, status, queryId: refreshed }
        }
      }
    } catch {
      // Keep original failure message below.
    }
    throw new Error('all query IDs returned 404 for CreateTweet')
  }

  private async withQueryIdRetry(operationName: string, extraFallbacks: string[], call: (queryId: string) => Promise<{ body: unknown; status: number }>): Promise<unknown> {
    const response = await this.withQueryIdRetryResponse(operationName, extraFallbacks, call)
    return response.body
  }

  private async withQueryIdRetryResponse(operationName: string, extraFallbacks: string[], call: (queryId: string) => Promise<{ body: unknown; status: number }>): Promise<{ body: unknown; status: number; queryId: string }> {
    const primary = await this.queryIds.get(operationName)
    const candidates = [...new Set([primary, ...extraFallbacks].filter((id) => id !== ''))]
    for (const candidate of candidates) {
      const { body, status } = await call(candidate)
      if (status !== 404) {
        return { body, status, queryId: candidate }
      }
    }
    try {
      await this.queryIds.refresh(this.baseUrl)
      const refreshed = await this.queryIds.get(operationName)
      if (refreshed !== '' && !candidates.includes(refreshed)) {
        const { body, status } = await call(refreshed)
        if (status !== 404) {
          return { body, status, queryId: refreshed }
        }
      }
    } catch {
      // Keep original failure message below.
    }
    throw new Error(`all query IDs returned 404 for ${operationName}`)
  }

  private async logDebug(event: string, data?: Record<string, unknown>): Promise<void> {
    try {
      await this.debugLogger?.log(event, data)
    } catch {
      // Debug logging must never break user actions.
    }
  }
}

const createTweetHeaderStrategies = (headers: HeaderBuilder): Array<{ name: string; headers: HeadersInit }> => {
  const xWeb = {
    ...headers.jsonHeaders({ authType: 'OAuth2Session', origin: 'https://x.com', referer: 'https://x.com/compose/post' }),
    'accept-language': 'en-GB,en;q=0.5',
    priority: 'u=1, i',
    'sec-ch-ua': '"Chromium";v="146", "Not-A.Brand";v="24", "Brave";v="146"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'sec-gpc': '1'
  }
  const minimal: Record<string, string> = {}
  for (const key of ['accept', 'accept-language', 'authorization', 'cookie', 'content-type', 'origin', 'referer', 'user-agent', 'x-client-transaction-id', 'x-csrf-token', 'x-twitter-active-user', 'x-twitter-auth-type', 'x-twitter-client-language']) {
    const value = (xWeb as Record<string, string>)[key]
    if (value) {
      minimal[key] = value
    }
  }

  return [
    { name: 'x-web-curl-shape', headers: xWeb },
    { name: 'x-web-minimal', headers: minimal }
  ]
}

const parseCurrentUser = (text: string): AuthStatus => {
  const asJson = tryParseJson(text)
  if (isRecord(asJson)) {
    const username = getStr(asJson, 'screen_name') || getStr(asJson, 'screenName')
    if (username !== '') {
      return {
        ok: true,
        username,
        userId: getStr(asJson, 'id_str') || getStr(asJson, 'user_id') || undefined,
        name: getStr(asJson, 'name') || undefined,
        source: 'account-api'
      }
    }
  }
  const screenName = /"screen_name":"([^"]+)"/.exec(text)?.[1]
  if (screenName) {
    return {
      ok: true,
      username: screenName,
      userId: /"user_id"\s*:\s*"(\d+)"/.exec(text)?.[1] ?? /"id_str":"(\d+)"/.exec(text)?.[1],
      name: /"name":"([^"\\]*(?:\\.[^"\\]*)*)"/.exec(text)?.[1],
      source: 'settings'
    }
  }
  return { ok: false, error: 'no user in response' }
}

const tryParseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

const firstError = (body: unknown): { message: string; code?: number } => {
  const top = errorFromList(getSlice(body, 'errors'))
  if (top.message !== '') {
    return top
  }
  return errorFromList(getSlice(getMap(getMap(body, 'data'), 'create_tweet'), 'errors'))
}

const errorFromList = (errors: unknown[] | undefined): { message: string; code?: number } => {
  for (const item of errors ?? []) {
    const message = getStr(item, 'message')
    if (message === '') {
      continue
    }
    const code = isRecord(item) && typeof item.code === 'number' ? Math.trunc(item.code) : undefined
    return { message, code }
  }
  return { message: '' }
}
