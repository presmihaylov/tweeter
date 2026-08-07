import { alreadyFavoritedCode, defaultBaseUrl, defaultGraphQLBase, defaultUserAgent, notBookmarkedCode, retryDelaysFor, tweetDetailQueryIdFallbacks } from './constants.ts'
import { buildArticleFieldToggles, buildCreateTweetFeatures, buildHomeTimelineFeatures, buildTweetDetailFeatures } from './features.ts'
import { GraphQLClient } from './graphql.ts'
import { HeaderBuilder } from './headers.ts'
import { PageContextStore } from './pageContext.ts'
import { QueryIdStore } from './queryIds.ts'
import { generateTransactionId } from './transactionId.ts'
import { statusUrl } from './urls.ts'
import type { AuthStatus, ConversationPage, DeleteResult, LikeResult, PostResult, TimelinePage, TweetBundle, TwitterClientOptions, WriteRetryNotice } from './types.ts'
import { extractCursorFromInstructions, getHomeInstructions, getTweetDetailInstructions, parseConversationTweets, parseHomeTweets } from './extract/index.ts'
import { getMap, getSlice, getStr, isRecord } from '../utils/guards.ts'
import type { Fetcher } from '../utils/fetcher.ts'
import { defaultFetcher } from '../utils/fetcher.ts'
import { errorMessage } from '../utils/result.ts'
import type { DebugLogger } from '../utils/debugLog.ts'
import { safeJsonSnippet } from '../utils/debugLog.ts'

export class TwitterClient {
  private readonly baseUrl: string
  private readonly headers: HeaderBuilder
  private readonly gql: GraphQLClient
  private readonly queryIds: QueryIdStore
  private readonly pageContext: PageContextStore
  private readonly fetchImpl: Fetcher
  private readonly debugLogger?: DebugLogger
  private readonly sleep: (ms: number) => Promise<void>
  private lastTransactionIdSent = false

  constructor(opts: TwitterClientOptions) {
    this.baseUrl = opts.baseUrl ?? defaultBaseUrl
    this.fetchImpl = opts.fetch ?? defaultFetcher
    this.debugLogger = opts.debugLogger
    this.sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    this.headers = new HeaderBuilder({
      authToken: opts.authToken,
      ct0: opts.ct0,
      userAgent: opts.userAgent ?? defaultUserAgent,
      cookieHeader: opts.cookieHeader
    })
    this.queryIds = new QueryIdStore(opts.queryIdPath, this.fetchImpl, () => this.headers.htmlHeaders())
    this.pageContext = new PageContextStore(this.baseUrl, this.fetchImpl, () => this.headers.htmlHeaders())
    this.gql = new GraphQLClient(opts.graphQLBase ?? defaultGraphQLBase, this.headers, this.fetchImpl, (path, method) => this.transactionIdFor(path, method))
  }

  // Fail open. Omitting the header is what the TUI did before and reads still work, so a
  // shell that cannot be parsed must not stop a request. The debug log records every miss.
  private async transactionIdFor(path: string, method: string): Promise<string | undefined> {
    try {
      const page = await this.pageContext.get()
      if (!page) {
        this.lastTransactionIdSent = false
        await this.debugLogger?.log('twitter.transactionId.noPageContext', { path, method })
        return undefined
      }
      const value = generateTransactionId({ path, method, page })
      this.lastTransactionIdSent = true
      return value
    } catch (error) {
      this.lastTransactionIdSent = false
      await this.debugLogger?.log('twitter.transactionId.failed', { path, method, error: errorMessage(error) })
      return undefined
    }
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

  async loadHomeTimelinePage(args: { count: number; following: boolean; ranked?: boolean; cursor?: string }): Promise<TimelinePage> {
    const operationName = args.following ? 'HomeLatestTimeline' : 'HomeTimeline'
    const variables: Record<string, unknown> = {
      count: args.count,
      includePromotedContent: true,
      latestControlAvailable: true,
      requestContext: args.cursor ? 'scroll' : 'launch',
      withCommunity: true
    }
    // The "Sort by" menu on the Following tab is this one variable. true is Popular,
    // false is Recent, and an absent variable behaves as false. For You ranks either way
    // and rejects nothing, but it has no such menu, so it never carries the variable.
    if (args.following) {
      variables.enableRanking = args.ranked === true
    }
    if (args.cursor) {
      variables.cursor = args.cursor
    }
    const { body } = await this.withQueryIdRetry(operationName, [], async (queryId) => {
      return this.gql.get(operationName, queryId, variables, buildHomeTimelineFeatures())
    })
    const instructions = getHomeInstructions(body)
    return {
      tweets: parseHomeTweets(instructions),
      topCursor: extractCursorFromInstructions(instructions, 'Top'),
      bottomCursor: extractCursorFromInstructions(instructions, 'Bottom')
    }
  }

  async getTweet(tweetId: string): Promise<TweetBundle> {
    const body = await this.tweetDetailRequest(tweetId)
    const instructions = getTweetDetailInstructions(body)
    const tweets = parseConversationTweets(instructions)
    const tweet = tweets.find((candidate) => candidate.id === tweetId) ?? tweets[0]
    if (!tweet) {
      throw new Error('tweet not found in response')
    }
    return { tweet, related: tweets.filter((candidate) => candidate.id !== tweet.id) }
  }

  async loadRepliesPage(args: { tweetId: string; cursor?: string }): Promise<ConversationPage> {
    const body = await this.tweetDetailRequest(args.tweetId, args.cursor)
    const instructions = getTweetDetailInstructions(body)
    const tweets = parseConversationTweets(instructions)
    return {
      tweetId: args.tweetId,
      replies: tweets.filter((tweet) => tweet.id !== args.tweetId),
      cursor: extractCursorFromInstructions(instructions, 'Bottom'),
      focal: tweets.find((tweet) => tweet.id === args.tweetId)
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

  // Code 344 is X's write guard, not the daily cap its message names, and code 226 is its
  // automation gate. Both refuse the request rather than the reader, and both pass later, so
  // the TUI asks again on a growing delay instead of making the reader press the key. Every
  // write that fails this way created nothing, so no retry can post twice. Each code counts
  // its own attempts, because a run can start on one code and end on the other.
  private async withWriteRetry<T extends { ok: boolean; code?: number }>(operationName: string, onRetry: ((notice: WriteRetryNotice) => void) | undefined, call: () => Promise<T>): Promise<T> {
    const spent = new Map<number, number>()
    for (;;) {
      const result = await call()
      if (result.ok || result.code === undefined) {
        return result
      }
      const delays = retryDelaysFor(result.code)
      const attempt = spent.get(result.code) ?? 0
      const delayMs = delays[attempt]
      if (delayMs === undefined) {
        return result
      }
      spent.set(result.code, attempt + 1)
      const notice: WriteRetryNotice = { attempt: attempt + 1, attempts: delays.length, delayMs, code: result.code }
      await this.debugLogger?.log('twitter.write.retry', { operationName, ...notice })
      onRetry?.(notice)
      await this.sleep(delayMs)
    }
  }

  // The web app posts a reply with the same cookies it reads with, so the TUI does too.
  // The reply block is what makes CreateTweet answer a tweet instead of starting one.
  async replyToTweet(args: { tweetId: string; text: string; onRetry?: (notice: WriteRetryNotice) => void }): Promise<PostResult> {
    return this.createTweet({
      reply: { in_reply_to_tweet_id: args.tweetId, exclude_reply_user_ids: [] }
    }, args.text, args.onRetry)
  }

  // A repost with your own words is one CreateTweet that carries the quoted tweet as a link,
  // which is what x.com sends. It starts a tweet rather than answering one, so it takes no
  // reply block. X does not count the link against the 280 characters.
  async quoteTweet(args: { tweetId: string; handle: string; text: string; onRetry?: (notice: WriteRetryNotice) => void }): Promise<PostResult> {
    return this.createTweet({ attachment_url: statusUrl(args.handle, args.tweetId) }, args.text, args.onRetry)
  }

  private async createTweet(extra: Record<string, unknown>, text: string, onRetry?: (notice: WriteRetryNotice) => void): Promise<PostResult> {
    const variables: Record<string, unknown> = {
      tweet_text: text,
      ...extra,
      dark_request: false,
      media: { media_entities: [], possibly_sensitive: false },
      semantic_annotation_ids: []
    }
    return this.withWriteRetry('CreateTweet', onRetry, async () => {
      try {
        const { body, status } = await this.withQueryIdRetry('CreateTweet', [], async (queryId) => {
          return this.gql.post('CreateTweet', queryId, variables, buildCreateTweetFeatures(), undefined, this.headers.jsonHeaders({ referer: 'https://x.com/home' }))
        })
        const result = interpretCreateTweet(body, status)
        if (!result.ok) {
          // X can refuse with a bare 200 and no errors array, so the body is the only evidence.
          await this.debugLogger?.log('twitter.createTweet.refused', { status, code: result.code, transactionIdSent: this.lastTransactionIdSent, body: safeJsonSnippet(body) })
          // A refusal is the one signal that the page data may be stale, so drop it. The key
          // rotates per response and the next attempt should carry a fresh one.
          await this.pageContext.refresh().catch(() => undefined)
        }
        return result
      } catch (error) {
        return { ok: false, error: errorMessage(error) }
      }
    })
  }

  // One call for both directions, because the two operations differ only in their name and
  // in the field they answer under. X returns the string "Done" on success.
  async setLike(args: { tweetId: string; liked: boolean; onRetry?: (notice: WriteRetryNotice) => void }): Promise<LikeResult> {
    const operationName = args.liked ? 'FavoriteTweet' : 'UnfavoriteTweet'
    const field = args.liked ? 'favorite_tweet' : 'unfavorite_tweet'
    return this.withWriteRetry(operationName, args.onRetry, async () => {
      try {
        const { body, status } = await this.withQueryIdRetry(operationName, [], async (queryId) => {
          return this.gql.post(operationName, queryId, { tweet_id: args.tweetId }, {}, undefined, this.headers.jsonHeaders({ referer: 'https://x.com/home' }))
        })
        if (getStr(getMap(body, 'data'), field) === 'Done') {
          return { ok: true }
        }
        const failure = graphQLError(body, status)
        if (failure.code === alreadyFavoritedCode) {
          return { ok: true }
        }
        await this.debugLogger?.log('twitter.setLike.refused', { operationName, tweetId: args.tweetId, status, code: failure.code, transactionIdSent: this.lastTransactionIdSent, body: safeJsonSnippet(body) })
        return { ok: false, ...failure }
      } catch (error) {
        return { ok: false, error: errorMessage(error) }
      }
    })
  }

  // The same shape as setLike: one call for both directions, and X answers "Done". A bookmark
  // is private, so nothing here is visible to anybody but the account that made it.
  async setBookmark(args: { tweetId: string; bookmarked: boolean; onRetry?: (notice: WriteRetryNotice) => void }): Promise<LikeResult> {
    const operationName = args.bookmarked ? 'CreateBookmark' : 'DeleteBookmark'
    const field = args.bookmarked ? 'tweet_bookmark_put' : 'tweet_bookmark_delete'
    return this.withWriteRetry(operationName, args.onRetry, async () => {
      try {
        const { body, status } = await this.withQueryIdRetry(operationName, [], async (queryId) => {
          return this.gql.post(operationName, queryId, { tweet_id: args.tweetId }, {}, undefined, this.headers.jsonHeaders({ referer: 'https://x.com/home' }))
        })
        if (getStr(getMap(body, 'data'), field) === 'Done') {
          return { ok: true }
        }
        const failure = graphQLError(body, status)
        // X answers a repeat with its own code in each direction. The tweet already carries
        // what the caller asked for, so the call did its job.
        if (failure.code === alreadyFavoritedCode || failure.code === notBookmarkedCode) {
          return { ok: true }
        }
        await this.debugLogger?.log('twitter.setBookmark.refused', { operationName, tweetId: args.tweetId, status, code: failure.code, transactionIdSent: this.lastTransactionIdSent, body: safeJsonSnippet(body) })
        return { ok: false, ...failure }
      } catch (error) {
        return { ok: false, error: errorMessage(error) }
      }
    })
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
  return { error: `X refused the write and gave no reason (status ${status}); the response body is in the log`, status }
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
