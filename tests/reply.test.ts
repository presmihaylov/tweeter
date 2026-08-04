import { describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { TwitterClient } from '../src/twitter/client.ts'
import { composerHeading } from '../src/app/mainScreen.ts'
import { initialAppState, mergeTimelinePage } from '../src/state/store.ts'
import { jsonResponse, makeTweetResult, textResponse } from './helpers.ts'
import { parseTweetsFromInstructions } from '../src/twitter/extract/tweet.ts'
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

// X answers a refused write with HTTP 200 and an errors array, never a 4xx.
const refusedBody = (code: number, message: string): unknown => ({ data: {}, errors: [{ code, message }] })

const tempQueryIdPath = async (): Promise<string> =>
  join(await mkdtemp(join(tmpdir(), 'tweeter-qid-')), 'queryIds.json')

const clientWith = async (fetchMock: Fetcher): Promise<TwitterClient> =>
  new TwitterClient({ authToken: 'auth', ct0: 'csrf', fetch: fetchMock, graphQLBase, queryIdPath: await tempQueryIdPath() })

describe('replying with cookies', () => {
  test('posts CreateTweet with the reply block and returns the new tweet id', async () => {
    let sent: { url: string; body: unknown; headers: Record<string, string> } | undefined
    const client = await clientWith(async (input, init) => {
      sent = {
        url: input.toString(),
        body: JSON.parse(String(init?.body)) as unknown,
        headers: (init?.headers ?? {}) as Record<string, string>
      }
      return jsonResponse(createdBody('999'))
    })
    const result = await client.replyToTweet({ tweetId: '42', text: 'hello there' })
    expect(result).toEqual({ ok: true, tweetId: '999' })
    expect(sent?.url).toContain('/CreateTweet')
    const body = sent?.body as { variables: Record<string, unknown>; features: Record<string, boolean> }
    expect(body.variables.tweet_text).toBe('hello there')
    expect(body.variables.reply).toEqual({ in_reply_to_tweet_id: '42', exclude_reply_user_ids: [] })
    expect(body.features.responsive_web_edit_tweet_api_enabled).toBe(true)
    expect(sent?.headers['sec-fetch-site']).toBe('same-origin')
  })

  test('reports the automation gate instead of claiming success', async () => {
    const client = await clientWith(async () =>
      jsonResponse(refusedBody(226, 'This request looks like it might be automated. Please try again later.')))
    const result = await client.replyToTweet({ tweetId: '42', text: 'hi' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe(226)
      expect(result.error).toContain('looks like it might be automated')
    }
  })

  test('strips the Authorization prefix and the repeated code from a refusal', async () => {
    const client = await clientWith(async () =>
      jsonResponse(refusedBody(186, 'Authorization: Tweet needs to be a bit shorter. (186)')))
    const result = await client.replyToTweet({ tweetId: '42', text: 'x' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('Tweet needs to be a bit shorter.')
    }
  })

  test('names the cookies when X rejects the session outright', async () => {
    const client = await clientWith(async () => jsonResponse({}, { status: 403 }))
    const result = await client.replyToTweet({ tweetId: '42', text: 'x' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('refresh auth_token and ct0')
    }
  })

  test('rediscovers the query id from the signed-in shell when the cached one is retired', async () => {
    const attempted: string[] = []
    const client = await clientWith(async (input) => {
      const url = input.toString()
      if (url.endsWith('/home')) {
        return textResponse('<script src="https://abs.twimg.com/responsive-web/client-web/main.abc.js"></script>')
      }
      if (url.includes('main.abc.js')) {
        return textResponse('operationName:"CreateTweet",queryId:"FRESHCREATEID1"')
      }
      if (url.includes('CreateTweet')) {
        attempted.push(url)
        return url.includes('FRESHCREATEID1') ? jsonResponse(createdBody('777')) : jsonResponse({}, { status: 404 })
      }
      return jsonResponse({}, { status: 404 })
    })
    const result = await client.replyToTweet({ tweetId: '42', text: 'hi' })
    expect(result).toEqual({ ok: true, tweetId: '777' })
    expect(attempted).toHaveLength(2)
  })

  test('deleteTweet reports success and failure apart', async () => {
    const ok = await clientWith(async () => jsonResponse({ data: { delete_tweet: { tweet_results: {} } } }))
    expect(await ok.deleteTweet('999')).toEqual({ ok: true })
    const bad = await clientWith(async () => jsonResponse(refusedBody(144, 'No status found with that ID.')))
    const failed = await bad.deleteTweet('999')
    expect(failed.ok).toBe(false)
    if (!failed.ok) {
      expect(failed.code).toBe(144)
    }
  })
})

describe('composer heading', () => {
  const stateWithTweet = (draft: string, sending = false) => {
    const tweets = parseTweetsFromInstructions([{ entries: [{ content: { itemContent: { tweet_results: { result: makeTweetResult('42', 'alice', 'hi') } } } }] }])
    const base = mergeTimelinePage(initialAppState(), 'following', tweets, {})
    return { ...base, composer: { open: true, replyToTweetId: '42', draft, sending } }
  }

  test('names the handle and counts the draft', () => {
    expect(composerHeading(stateWithTweet('hello'))).toBe('Replying to @alice · 5/280 · Enter sends · Esc closes')
  })

  test('warns once the draft passes the limit', () => {
    expect(composerHeading(stateWithTweet('a'.repeat(281)))).toContain('281/280 too long')
  })

  test('says it is sending while the request is in flight', () => {
    expect(composerHeading(stateWithTweet('hello', true))).toBe('Replying to @alice · sending…')
  })
})
