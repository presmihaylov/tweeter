import { describe, expect, test } from 'bun:test'
import { bookmarkCount, metricsLine } from '../src/app/mainScreen.ts'
import { applyBookmark, initialAppState, mergeTweets } from '../src/state/store.ts'
import { TwitterClient } from '../src/twitter/client.ts'
import { jsonResponse } from './helpers.ts'
import type { AppTweet } from '../src/twitter/types.ts'

const tweet = (id: string, bookmarks: number, bookmarked?: boolean, quotedTweet?: AppTweet): AppTweet => ({
  id,
  text: `tweet ${id}`,
  author: { handle: `u${id}`, name: `U${id}` },
  media: [],
  metrics: { bookmarks },
  ...(bookmarked === undefined ? {} : { bookmarked }),
  ...(quotedTweet === undefined ? {} : { quotedTweet, quotedTweetId: quotedTweet.id })
})

const clientFor = (fetchMock: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): TwitterClient =>
  new TwitterClient({ authToken: 'auth', ct0: 'csrf', fetch: fetchMock, graphQLBase: 'https://x.com/i/api/graphql' })

describe('the bookmark mutation', () => {
  test('posts CreateBookmark and DeleteBookmark with the tweet id', async () => {
    const calls: { operation: string; body: unknown }[] = []
    const client = clientFor(async (input, init) => {
      const path = new URL(input.toString()).pathname
      // The client also fetches the x.com shell to sign the request; only the mutations count.
      if (!path.includes('/graphql/')) {
        return jsonResponse({}, { status: 404 })
      }
      const operation = path.split('/').pop() ?? ''
      calls.push({ operation, body: JSON.parse(String(init?.body ?? '{}')) as unknown })
      const field = operation === 'CreateBookmark' ? 'tweet_bookmark_put' : 'tweet_bookmark_delete'
      return jsonResponse({ data: { [field]: 'Done' } })
    })
    expect(await client.setBookmark({ tweetId: '10', bookmarked: true })).toEqual({ ok: true })
    expect(await client.setBookmark({ tweetId: '10', bookmarked: false })).toEqual({ ok: true })
    expect(calls.map((call) => call.operation)).toEqual(['CreateBookmark', 'DeleteBookmark'])
    expect(calls[0]?.body).toMatchObject({ variables: { tweet_id: '10' } })
  })

  test('counts a repeat in either direction as success', async () => {
    const already = clientFor(async () => jsonResponse({ errors: [{ message: 'You have already favorited this status.', code: 139 }] }))
    expect(await already.setBookmark({ tweetId: '10', bookmarked: true })).toEqual({ ok: true })

    const gone = clientFor(async () => jsonResponse({ errors: [{ message: "Sorry, that page does not exist. It was not found in actor's favorites.", code: 144 }] }))
    expect(await gone.setBookmark({ tweetId: '10', bookmarked: false })).toEqual({ ok: true })
  })

  test('reports any other refusal with its code', async () => {
    const client = clientFor(async () => jsonResponse({ errors: [{ message: 'Authorization: Denied by access control (179)', code: 179 }] }))
    const result = await client.setBookmark({ tweetId: '10', bookmarked: true })
    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ code: 179, error: 'Denied by access control' })
  })

  // The endpoint answers a wrong x-client-transaction-id with a bare 404, which reads exactly
  // like a dead query ID. The client has to give up rather than hang on the retry ladder.
  test('gives up with a plain message when every query ID answers 404', async () => {
    const client = clientFor(async () => jsonResponse({}, { status: 404 }))
    const result = await client.setBookmark({ tweetId: '10', bookmarked: true })
    expect(result).toMatchObject({ ok: false })
    expect(result.ok ? '' : result.error).toContain('CreateBookmark')
  })
})

describe('the bookmark on screen', () => {
  test('moves the mark and the count before X answers', () => {
    const state = mergeTweets(initialAppState(), [tweet('10', 3)])
    const marked = applyBookmark(state, '10', true)
    expect(marked.tweets['10']?.bookmarked).toBe(true)
    expect(marked.tweets['10']?.metrics.bookmarks).toBe(4)
    const reverted = applyBookmark(marked, '10', false)
    expect(reverted.tweets['10']?.bookmarked).toBe(false)
    expect(reverted.tweets['10']?.metrics.bookmarks).toBe(3)
  })

  test('moves the quoted copy too, so the two cards agree', () => {
    const quoted = tweet('20', 7)
    const state = mergeTweets(initialAppState(), [tweet('10', 3, undefined, quoted)])
    const marked = applyBookmark(state, '20', true)
    expect(marked.tweets['20']?.metrics.bookmarks).toBe(8)
    expect(marked.tweets['10']?.quotedTweet?.metrics.bookmarks).toBe(8)
    expect(marked.tweets['10']?.quotedTweet?.bookmarked).toBe(true)
    expect(marked.tweets['10']?.metrics.bookmarks).toBe(3)
  })

  test('ignores a tweet it does not hold and a bookmark already in that state', () => {
    const state = mergeTweets(initialAppState(), [tweet('10', 3, true)])
    expect(applyBookmark(state, '99', true)).toBe(state)
    expect(applyBookmark(state, '10', true)).toBe(state)
  })

  test('never shows a negative count', () => {
    const state = mergeTweets(initialAppState(), [tweet('10', 0, true)])
    expect(applyBookmark(state, '10', false).tweets['10']?.metrics.bookmarks).toBe(0)
  })

  test('draws the flag only on a bookmarked tweet', () => {
    expect(bookmarkCount(tweet('10', 3))).toBe('3 bookmarks')
    expect(bookmarkCount(tweet('10', 3, true))).toBe('⚑ 3 bookmarks')
    expect(metricsLine(tweet('10', 3, true))).toContain('⚑ 3 bookmarks')
  })
})
