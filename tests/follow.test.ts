import { describe, expect, test } from 'bun:test'
import { createTestRenderer } from '@opentui/core/testing'
import { createMainScreen, relationPills } from '../src/app/mainScreen.ts'
import { isFollowKey } from '../src/app/keyEvents.ts'
import { applyFollow, initialAppState, mergeTimelinePage, mergeTweets, relationOf } from '../src/state/store.ts'
import { TwitterClient } from '../src/twitter/client.ts'
import { mapTweetResult } from '../src/twitter/extract/tweet.ts'
import { parseLegacyTweets } from '../src/twitter/extract/legacyTweet.ts'
import { jsonResponse, legacyTweet, legacyUser, makeTweetResult } from './helpers.ts'
import type { AppKey } from '../src/app/keyEvents.ts'
import type { AppTweet, UserRelation } from '../src/twitter/types.ts'

// The same author on two tweets, so a follow has more than one card to move.
const tweet = (id: string, authorId: string | undefined, relation: UserRelation = {}): AppTweet => ({
  id,
  text: `tweet ${id}`,
  author: { ...(authorId === undefined ? {} : { id: authorId }), handle: 'alice', name: 'Alice', ...relation },
  media: [],
  metrics: {}
})

const withPerspectives = (result: unknown, perspectives: Record<string, boolean>): unknown => {
  const record = result as { core: { user_results: { result: Record<string, unknown> } } }
  const user = record.core.user_results.result
  return { ...record, core: { user_results: { result: { ...user, relationship_perspectives: perspectives } } } }
}

const clientFor = (fetchMock: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): TwitterClient =>
  new TwitterClient({ authToken: 'auth', ct0: 'csrf', fetch: fetchMock, graphQLBase: 'https://x.com/i/api/graphql' })

const key = (name: string, extra: Partial<AppKey> = {}): AppKey => ({ name, ctrl: false, ...extra })

describe('what X says about the author', () => {
  test('reads both directions out of the relationship map', () => {
    const raw = withPerspectives(makeTweetResult('1', 'alice', 'hello'), { following: true, followed_by: false, blocking: false })
    const mapped = mapTweetResult(raw)
    expect(mapped?.author.following).toBe(true)
    expect(mapped?.author.followedBy).toBe(false)
  })

  test('says nothing when X sent no map, which is not the same as a no', () => {
    const mapped = mapTweetResult(makeTweetResult('1', 'alice', 'hello'))
    expect(mapped?.author.following).toBeUndefined()
    expect(mapped?.author.followedBy).toBeUndefined()
  })

  test('reads the flags off the user itself in the old notifications shape', () => {
    const user = { ...(legacyUser('u1', 'alice') as Record<string, unknown>), following: true, followed_by: true }
    const tweets = parseLegacyTweets({ users: { u1: user }, tweets: { 5: legacyTweet('5', 'u1', 'hello') } })
    expect(tweets[0]?.author.following).toBe(true)
    expect(tweets[0]?.author.followedBy).toBe(true)
  })
})

describe('where the relationship is kept', () => {
  test('one map by account, so every card by that author agrees', () => {
    const state = mergeTweets(initialAppState(), [tweet('1', 'u1', { following: false }), tweet('2', 'u1')])
    expect(state.relations['u1']).toEqual({ following: false })
    const followed = applyFollow(state, 'u1', true)
    expect(relationOf(followed, followed.tweets['1'])?.following).toBe(true)
    expect(relationOf(followed, followed.tweets['2'])?.following).toBe(true)
  })

  test('a page that carries no flags cannot erase what is already known', () => {
    const known = mergeTweets(initialAppState(), [tweet('1', 'u1', { following: true, followedBy: true })])
    const later = mergeTweets(known, [tweet('2', 'u1')])
    expect(later.relations['u1']).toEqual({ following: true, followedBy: true })
  })

  test('an author X gave no id for still shows what came with the tweet', () => {
    const state = mergeTweets(initialAppState(), [tweet('1', undefined, { following: true })])
    expect(state.relations).toEqual({})
    expect(relationOf(state, state.tweets['1'])?.following).toBe(true)
    expect(relationOf(state, undefined)).toBeUndefined()
  })

  test('the map answers before the copy the card holds', () => {
    const state = mergeTweets(initialAppState(), [tweet('1', 'u1', { following: false })])
    expect(relationOf(applyFollow(state, 'u1', true), state.tweets['1'])?.following).toBe(true)
  })
})

describe('the badges on the open tweet', () => {
  test('names both facts, and only the ones X stated', () => {
    expect(relationPills({ following: true, followedBy: true })).toBe('  ·  ✓ following  ·  follows you')
    expect(relationPills({ following: false })).toBe('  ·  not following')
    expect(relationPills({ followedBy: true })).toBe('  ·  follows you')
    expect(relationPills({ following: true, followedBy: false })).toBe('  ·  ✓ following')
    expect(relationPills({})).toBe('')
    expect(relationPills(undefined)).toBe('')
  })

  test('the open tweet carries them next to the handle', async () => {
    const harness = await createTestRenderer({ width: 174, height: 52 })
    const screen = createMainScreen(harness.renderer, {})
    const state = mergeTimelinePage(initialAppState(), 'following', [tweet('1', 'u1', { following: true, followedBy: true })], {})
    // The first pass has no measured pane, so the row budget only lands on the second.
    screen.render(state)
    await harness.flush()
    screen.render(state)
    await harness.flush()
    const frame = harness.captureCharFrame()
    expect(frame).toContain('✓ following')
    expect(frame).toContain('follows you')
  })
})

describe('the follow key', () => {
  test('takes Shift+F however the terminal reports it', () => {
    expect(isFollowKey(key('F'))).toBe(true)
    expect(isFollowKey(key('f', { shift: true }))).toBe(true)
  })

  test('leaves a plain f, and every f a modifier claims', () => {
    expect(isFollowKey(key('f'))).toBe(false)
    expect(isFollowKey(key('F', { ctrl: true }))).toBe(false)
    expect(isFollowKey(key('F', { meta: true }))).toBe(false)
  })
})

describe('the follow write', () => {
  test('posts a form to create for a follow and to destroy for an unfollow', async () => {
    const calls: { path: string; contentType: string; form: string }[] = []
    const client = clientFor(async (input, init) => {
      const path = new URL(input.toString()).pathname
      if (!path.includes('/friendships/')) {
        return jsonResponse({}, { status: 404 })
      }
      const headers = new Headers(init?.headers)
      calls.push({ path, contentType: headers.get('content-type') ?? '', form: String(init?.body ?? '') })
      return jsonResponse({ id_str: '77', screen_name: 'alice' })
    })
    expect(await client.setFollow({ userId: '77', following: true })).toEqual({ ok: true })
    expect(await client.setFollow({ userId: '77', following: false })).toEqual({ ok: true })
    expect(calls.map((call) => call.path)).toEqual(['/i/api/1.1/friendships/create.json', '/i/api/1.1/friendships/destroy.json'])
    expect(calls[0]?.contentType).toBe('application/x-www-form-urlencoded')
    expect(new URLSearchParams(calls[0]?.form ?? '').get('user_id')).toBe('77')
    expect(new URLSearchParams(calls[0]?.form ?? '').get('skip_status')).toBe('1')
  })

  test('reports a refusal with its code, and the account it names', async () => {
    const client = clientFor(async () => jsonResponse({ errors: [{ code: 158, message: "You can't follow yourself." }] }, { status: 403 }))
    const result = await client.setFollow({ userId: '77', following: true })
    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ code: 158, error: "You can't follow yourself." })
  })

  test('an answer that is not JSON at all is a failure, not a follow', async () => {
    const client = clientFor(async () => new Response('<html>rate limited</html>', { status: 429 }))
    const result = await client.setFollow({ userId: '77', following: true })
    expect(result.ok).toBe(false)
  })
})
