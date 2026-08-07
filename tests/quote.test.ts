import { describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { TwitterClient } from '../src/twitter/client.ts'
import { composerHeading } from '../src/app/mainScreen.ts'
import { closeComposer, initialAppState, mergeTimelinePage, openComposer } from '../src/state/store.ts'
import { statusUrl } from '../src/twitter/urls.ts'
import { jsonResponse } from './helpers.ts'
import type { AppTweet } from '../src/twitter/types.ts'
import type { Fetcher } from '../src/utils/fetcher.ts'

const graphQLBase = 'https://x.com/i/api/graphql'

const createdBody = (tweetId: string): unknown => ({
  data: {
    create_tweet: {
      tweet_results: {
        result: {
          rest_id: tweetId,
          core: { user_results: { result: { rest_id: 'u1', legacy: { screen_name: 'me', name: 'Me' } } } },
          legacy: { full_text: 'hi', conversation_id_str: tweetId }
        }
      }
    }
  }
})

const tempQueryIdPath = async (): Promise<string> =>
  join(await mkdtemp(join(tmpdir(), 'tweeter-qid-')), 'queryIds.json')

const clientWith = async (fetchMock: Fetcher): Promise<TwitterClient> =>
  new TwitterClient({ authToken: 'auth', ct0: 'csrf', fetch: fetchMock, graphQLBase, queryIdPath: await tempQueryIdPath(), sleep: async () => undefined })

const tweet: AppTweet = { id: '42', text: 'hello', author: { handle: 'alice', name: 'Alice' }, media: [], metrics: {} }

const feed = (): ReturnType<typeof initialAppState> => mergeTimelinePage(initialAppState(), 'following', [tweet], {})

describe('a repost with your own words', () => {
  test('sends one CreateTweet that carries the quoted tweet as a link', async () => {
    let sent: { url: string; body: unknown } | undefined
    const client = await clientWith(async (input, init) => {
      sent = { url: input.toString(), body: JSON.parse(String(init?.body)) as unknown }
      return jsonResponse(createdBody('999'))
    })
    const result = await client.quoteTweet({ tweetId: '42', handle: 'alice', text: 'my thoughts' })
    expect(result).toEqual({ ok: true, tweetId: '999' })
    expect(sent?.url).toContain('/CreateTweet')
    const body = sent?.body as { variables: Record<string, unknown> }
    expect(body.variables.tweet_text).toBe('my thoughts')
    expect(body.variables.attachment_url).toBe(statusUrl('alice', '42'))
    // A quote starts a tweet, so a reply block would make X answer the tweet instead.
    expect(body.variables.reply).toBeUndefined()
  })

  test('reports a refusal rather than claiming success', async () => {
    const client = await clientWith(async () => jsonResponse({ data: {}, errors: [{ code: 226, message: 'This request looks like it might be automated.' }] }))
    const result = await client.quoteTweet({ tweetId: '42', handle: 'alice', text: 'hi' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe(226)
    }
  })
})

describe('the drawer a quote opens', () => {
  test('holds the mode and the tweet it reposts', () => {
    const state = openComposer(feed(), 'quote')
    expect(state.composer).toEqual({ open: true, mode: 'quote', targetTweetId: '42', draft: '', caret: 0, sending: false })
    expect(state.status).toBe('quoting @alice')
  })

  test('says which write it is about to make', () => {
    expect(composerHeading(openComposer(feed(), 'quote'))).toStartWith('Quoting @alice')
    expect(composerHeading(openComposer(feed(), 'reply'))).toStartWith('Replying to @alice')
  })

  test('a closed drawer keeps nothing of the draft', () => {
    const typed = { ...openComposer(feed(), 'quote'), status: 'x' }
    expect(closeComposer(typed).composer.open).toBe(false)
    expect(closeComposer(typed).composer.draft).toBe('')
  })

  test('opens nothing when no tweet is selected', () => {
    expect(openComposer(initialAppState(), 'quote').composer.open).toBe(false)
  })
})
