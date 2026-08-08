import { describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { TwitterClient } from '../src/twitter/client.ts'
import { composerHeading } from '../src/app/mainScreen.ts'
import { composerWhat, sendDraft, type DraftSender } from '../src/app/terminalApp.ts'
import { closeComposer, initialAppState, mergeTimelinePage, openComposer, type AppState } from '../src/state/store.ts'
import { jsonResponse } from './helpers.ts'
import type { AppTweet, PostResult } from '../src/twitter/types.ts'
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

const feed = (): AppState => mergeTimelinePage(initialAppState(), 'following', [tweet], {})

describe('a new post', () => {
  test('sends one CreateTweet with no reply block and no attachment', async () => {
    let sent: { url: string; body: unknown } | undefined
    const client = await clientWith(async (input, init) => {
      sent = { url: input.toString(), body: JSON.parse(String(init?.body)) as unknown }
      return jsonResponse(createdBody('999'))
    })
    const result = await client.postTweet({ text: 'good morning' })
    expect(result).toEqual({ ok: true, tweetId: '999' })
    expect(sent?.url).toContain('/CreateTweet')
    const body = sent?.body as { variables: Record<string, unknown> }
    expect(body.variables.tweet_text).toBe('good morning')
    expect(body.variables.reply).toBeUndefined()
    expect(body.variables.attachment_url).toBeUndefined()
  })

  test('reports a refusal rather than claiming success', async () => {
    const client = await clientWith(async () => jsonResponse({ data: {}, errors: [{ code: 226, message: 'This request looks like it might be automated.' }] }))
    const result = await client.postTweet({ text: 'hi' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe(226)
    }
  })
})

describe('the drawer of a new post', () => {
  test('opens with no tweet behind it, even on an empty feed', () => {
    const state = openComposer(initialAppState(), 'post')
    expect(state.composer.open).toBe(true)
    expect(state.composer.mode).toBe('post')
    expect(state.composer.targetTweetId).toBeUndefined()
    expect(state.status).toBe('writing a new post')
  })

  test('leaves the feed selection where it was', () => {
    const state = openComposer(feed(), 'post')
    expect(state.selectedTweetId).toBe(feed().selectedTweetId)
  })

  test('a reply still needs a tweet to answer', () => {
    const empty = initialAppState()
    expect(openComposer(empty, 'reply')).toBe(empty)
  })

  test('its heading names the post rather than a handle', () => {
    const state = openComposer(feed(), 'post')
    expect(composerHeading(state)).toBe('New post · 0/280 · Enter sends · Esc closes')
    expect(composerHeading({ ...state, composer: { ...state.composer, sending: true } })).toBe('New post · sending…')
  })

  test('a reply keeps its own heading', () => {
    expect(composerHeading(openComposer(feed(), 'reply'))).toContain('Replying to @alice')
  })

  test('Esc closes it and keeps nothing behind', () => {
    expect(closeComposer(openComposer(feed(), 'post')).composer.open).toBe(false)
  })
})

describe('which call the drawer makes', () => {
  const calls: string[] = []
  const ok: PostResult = { ok: true, tweetId: '1' }
  const client: DraftSender = {
    replyToTweet: async () => { calls.push('reply'); return ok },
    quoteTweet: async () => { calls.push('quote'); return ok },
    postTweet: async () => { calls.push('post'); return ok }
  }
  const send = async (mode: 'reply' | 'quote' | 'post', target?: AppTweet): Promise<void> => {
    await sendDraft({ client, mode, target, text: 'hi', onRetry: () => undefined })
  }

  test('the mode picks it', async () => {
    await send('reply', tweet)
    await send('quote', tweet)
    await send('post')
    expect(calls).toEqual(['reply', 'quote', 'post'])
  })

  test('the status line names each one', () => {
    expect(composerWhat('post')).toBe('post')
    expect(composerWhat('quote')).toBe('quote')
    expect(composerWhat('reply')).toBe('reply')
  })
})
