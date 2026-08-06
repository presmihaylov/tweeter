import { describe, expect, test } from 'bun:test'
import { likeCount, metricsLine } from '../src/app/mainScreen.ts'
import { applyLike, initialAppState, mergeTweets } from '../src/state/store.ts'
import { TwitterClient } from '../src/twitter/client.ts'
import { jsonResponse } from './helpers.ts'
import type { AppTweet } from '../src/twitter/types.ts'

const tweet = (id: string, likes: number, favorited?: boolean, quotedTweet?: AppTweet): AppTweet => ({
  id,
  text: `tweet ${id}`,
  author: { handle: `u${id}`, name: `U${id}` },
  media: [],
  metrics: { likes },
  ...(favorited === undefined ? {} : { favorited }),
  ...(quotedTweet === undefined ? {} : { quotedTweet, quotedTweetId: quotedTweet.id })
})

const clientFor = (fetchMock: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): TwitterClient =>
  new TwitterClient({ authToken: 'auth', ct0: 'csrf', fetch: fetchMock, graphQLBase: 'https://x.com/i/api/graphql' })

describe('the like mutation', () => {
  test('posts FavoriteTweet and UnfavoriteTweet with the tweet id', async () => {
    const calls: { operation: string; body: unknown }[] = []
    const client = clientFor(async (input, init) => {
      const path = new URL(input.toString()).pathname
      // The client also fetches the x.com shell to sign the request; only the mutations count.
      if (!path.includes('/graphql/')) {
        return jsonResponse({}, { status: 404 })
      }
      const operation = path.split('/').pop() ?? ''
      calls.push({ operation, body: JSON.parse(String(init?.body ?? '{}')) as unknown })
      const field = operation === 'FavoriteTweet' ? 'favorite_tweet' : 'unfavorite_tweet'
      return jsonResponse({ data: { [field]: 'Done' } })
    })
    expect(await client.setLike({ tweetId: '10', liked: true })).toEqual({ ok: true })
    expect(await client.setLike({ tweetId: '10', liked: false })).toEqual({ ok: true })
    expect(calls.map((call) => call.operation)).toEqual(['FavoriteTweet', 'UnfavoriteTweet'])
    expect(calls[0]?.body).toMatchObject({ variables: { tweet_id: '10' } })
  })

  test('counts a repeat like as success, because the tweet already carries it', async () => {
    const client = clientFor(async () => jsonResponse({ errors: [{ message: 'You have already favorited this status.', code: 139 }] }))
    expect(await client.setLike({ tweetId: '10', liked: true })).toEqual({ ok: true })
  })

  // Code 179 has no retry ladder, so the refusal comes straight back. writeRetry.test.ts covers
  // the codes that do wait.
  test('reports any other refusal with its code', async () => {
    const client = clientFor(async () => jsonResponse({ errors: [{ message: 'Authorization: Denied by access control (179)', code: 179 }] }))
    const result = await client.setLike({ tweetId: '10', liked: true })
    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ code: 179, error: 'Denied by access control' })
  })
})

describe('the like on screen', () => {
  test('moves the count and the heart before X answers', () => {
    const state = mergeTweets(initialAppState(), [tweet('10', 3)])
    const liked = applyLike(state, '10', true)
    expect(liked.tweets['10']?.favorited).toBe(true)
    expect(liked.tweets['10']?.metrics.likes).toBe(4)
    const reverted = applyLike(liked, '10', false)
    expect(reverted.tweets['10']?.favorited).toBe(false)
    expect(reverted.tweets['10']?.metrics.likes).toBe(3)
  })

  test('moves the quoted copy too, so the two cards agree', () => {
    const quoted = tweet('20', 7)
    const state = mergeTweets(initialAppState(), [tweet('10', 3, undefined, quoted)])
    const liked = applyLike(state, '20', true)
    expect(liked.tweets['20']?.metrics.likes).toBe(8)
    expect(liked.tweets['10']?.quotedTweet?.metrics.likes).toBe(8)
    expect(liked.tweets['10']?.quotedTweet?.favorited).toBe(true)
    expect(liked.tweets['10']?.metrics.likes).toBe(3)
  })

  test('ignores a tweet it does not hold and a like already in that state', () => {
    const state = mergeTweets(initialAppState(), [tweet('10', 3, true)])
    expect(applyLike(state, '99', true)).toBe(state)
    expect(applyLike(state, '10', true)).toBe(state)
  })

  test('never shows a negative count', () => {
    const state = mergeTweets(initialAppState(), [tweet('10', 0, true)])
    expect(applyLike(state, '10', false).tweets['10']?.metrics.likes).toBe(0)
  })

  test('fills the heart only on a liked tweet', () => {
    expect(likeCount(tweet('10', 3))).toBe('3 likes')
    expect(likeCount(tweet('10', 3, true))).toBe('♥ 3 likes')
    expect(metricsLine(tweet('10', 3, true))).toContain('♥ 3 likes')
  })
})
