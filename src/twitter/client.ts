import { defaultBaseUrl, defaultGraphQLBase, defaultUserAgent, tweetDetailQueryIdFallbacks } from './constants.ts'
import { buildArticleFieldToggles, buildCreateTweetFeatures, buildHomeTimelineFeatures, buildTweetDetailFeatures } from './features.ts'
import { GraphQLClient } from './graphql.ts'
import { HeaderBuilder } from './headers.ts'
import { QueryIdStore } from './queryIds.ts'
import type { AuthStatus, ConversationPage, DeleteResult, PostResult, TimelinePage, TweetBundle, TwitterClientOptions } from './types.ts'
import { extractCursorFromInstructions, getHomeInstructions, getTweetDetailInstructions, parseTweetsFromInstructions } from './extract/index.ts'
import { getMap, getSlice, getStr, isRecord } from '../utils/guards.ts'
import type { Fetcher } from '../utils/fetcher.ts'
import { defaultFetcher } from '../utils/fetcher.ts'
import { errorMessage } from '../utils/result.ts'
import type { DebugLogger } from '../utils/debugLog.ts'

export class TwitterClient {
  private readonly baseUrl: string
  private readonly headers: HeaderBuilder
  private readonly gql: GraphQLClient
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
    this.queryIds = new QueryIdStore(opts.queryIdPath, this.fetchImpl, () => this.headers.htmlHeaders())
    this.gql = new GraphQLClient(opts.graphQLBase ?? defaultGraphQLBase, this.headers, this.fetchImpl)
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
    // X retired the v1.1 account endpoints, so fall back to the read path the TUI actually uses.
    try {
      const page = await this.loadHomeTimelinePage({ count: 1, following: true })
      if (page.tweets.length > 0) {
        return { ok: true, source: 'timeline-probe' }
      }
    } catch {
      return { ok: false, error: 'X cookies rejected; refresh auth_token and ct0' }
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
    const { body } = await this.withQueryIdRetry(operationName, [], async (queryId) => {
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
    const { body } = await this.withQueryIdRetry('TweetDetail', [...tweetDetailQueryIdFallbacks], async (queryId) => {
      return this.gql.getThenPost('TweetDetail', queryId, variables, buildTweetDetailFeatures(), buildArticleFieldToggles())
    })
    return body
  }

  // The web app posts a reply with the same cookies it reads with, so the TUI does too.
  // The reply block is what makes CreateTweet answer a tweet instead of starting one.
  async replyToTweet(args: { tweetId: string; text: string }): Promise<PostResult> {
    const variables: Record<string, unknown> = {
      tweet_text: args.text,
      reply: { in_reply_to_tweet_id: args.tweetId, exclude_reply_user_ids: [] },
      dark_request: false,
      media: { media_entities: [], possibly_sensitive: false },
      semantic_annotation_ids: []
    }
    try {
      const { body, status } = await this.withQueryIdRetry('CreateTweet', [], async (queryId) => {
        return this.gql.post('CreateTweet', queryId, variables, buildCreateTweetFeatures(), undefined, this.headers.jsonHeaders({ referer: 'https://x.com/home' }))
      })
      return interpretCreateTweet(body, status)
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  }

  async deleteTweet(tweetId: string): Promise<DeleteResult> {
    try {
      const { body, status } = await this.withQueryIdRetry('DeleteTweet', [], async (queryId) => {
        return this.gql.post('DeleteTweet', queryId, { tweet_id: tweetId, dark_request: false }, {}, undefined, this.headers.jsonHeaders({ referer: 'https://x.com/home' }))
      })
      if (getMap(getMap(body, 'data'), 'delete_tweet') !== undefined) {
        return { ok: true }
      }
      return { ok: false, ...graphQLError(body, status) }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  }

  private async withQueryIdRetry(operationName: string, extraFallbacks: string[], call: (queryId: string) => Promise<{ body: unknown; status: number }>): Promise<{ body: unknown; status: number }> {
    const primary = await this.queryIds.get(operationName)
    const candidates = [...new Set([primary, ...extraFallbacks].filter((id) => id !== ''))]
    for (const candidate of candidates) {
      const result = await call(candidate)
      if (result.status !== 404) {
        return result
      }
    }
    try {
      await this.queryIds.refresh(this.baseUrl)
      const refreshed = await this.queryIds.get(operationName)
      if (refreshed !== '' && !candidates.includes(refreshed)) {
        const result = await call(refreshed)
        if (result.status !== 404) {
          return result
        }
      }
    } catch {
      await this.debugLogger?.log('twitter.queryIdRefresh.error', { operationName })
    }
    throw new Error(`all query IDs returned 404 for ${operationName}`)
  }
}

// X answers a refused write with HTTP 200 and an errors array, so the status alone never
// says whether the reply landed. The created tweet's id is the only proof of success.
const interpretCreateTweet = (body: unknown, status: number): PostResult => {
  const created = getMap(getMap(getMap(body, 'data'), 'create_tweet'), 'tweet_results')
  const tweetId = getStr(getMap(created, 'result'), 'rest_id')
  if (tweetId !== '') {
    return { ok: true, tweetId }
  }
  return { ok: false, ...graphQLError(body, status) }
}

const graphQLError = (body: unknown, status: number): { error: string; code?: number; status: number } => {
  for (const item of getSlice(body, 'errors') ?? []) {
    const message = getStr(item, 'message')
    if (message === '') {
      continue
    }
    const code = isRecord(item) && typeof item.code === 'number' ? Math.trunc(item.code) : undefined
    // X prefixes a refusal with "Authorization: " and repeats the code in brackets.
    return { error: message.replace(/^Authorization:\s*/, '').replace(/\s*\(\d+\)$/, ''), code, status }
  }
  if (status === 401 || status === 403) {
    return { error: 'X rejected the cookies; refresh auth_token and ct0', status }
  }
  return { error: `X refused the write with status ${status}`, status }
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
