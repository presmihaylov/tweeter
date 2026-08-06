import { describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { TwitterClient } from '../src/twitter/client.ts'
import { composerBody, composerHeading, composerLines, composerTextCap, replyFailure } from '../src/app/mainScreen.ts'
import { initialAppState, mergeTimelinePage } from '../src/state/store.ts'
import { jsonResponse, makeTweetResult, shellHtml, textResponse } from './helpers.ts'
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

// The retry ladders wait minutes on a refused write, so the tests spend no time on them.
const clientWith = async (fetchMock: Fetcher): Promise<TwitterClient> =>
  new TwitterClient({ authToken: 'auth', ct0: 'csrf', fetch: fetchMock, graphQLBase, queryIdPath: await tempQueryIdPath(), sleep: async () => undefined })

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

  test('logs the response body when X refuses with a bare 200', async () => {
    const logged: { event: string; data: Record<string, unknown> }[] = []
    const debugLogger = {
      path: '/dev/null',
      log: async (event: string, data: Record<string, unknown> = {}): Promise<void> => {
        logged.push({ event, data })
      }
    }
    const client = new TwitterClient({
      authToken: 'auth',
      ct0: 'csrf',
      graphQLBase,
      queryIdPath: await tempQueryIdPath(),
      debugLogger,
      // X gives no errors array here, so the body is the only clue to what happened.
      fetch: async () => jsonResponse({ data: {} })
    })
    const result = await client.replyToTweet({ tweetId: '42', text: 'hi' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('gave no reason')
    }
    const refusal = logged.find((entry) => entry.event === 'twitter.createTweet.refused')
    expect(refusal?.data.status).toBe(200)
    expect(refusal?.data.body).toBe('{"data":{}}')
  })

  test('a successful reply logs no refusal', async () => {
    const logged: string[] = []
    const client = new TwitterClient({
      authToken: 'auth',
      ct0: 'csrf',
      graphQLBase,
      queryIdPath: await tempQueryIdPath(),
      debugLogger: { path: '/dev/null', log: async (event: string): Promise<void> => { logged.push(event) } },
      fetch: async (input) => input.toString().endsWith('/home') ? textResponse(shellHtml()) : jsonResponse(createdBody('999'))
    })
    expect(await client.replyToTweet({ tweetId: '42', text: 'hi' })).toEqual({ ok: true, tweetId: '999' })
    expect(logged).toEqual([])
  })

  test('signs CreateTweet with a transaction id read from the shell', async () => {
    const seen: string[] = []
    let shellRequests = 0
    const client = await clientWith(async (input, init) => {
      if (input.toString().endsWith('/home')) {
        shellRequests += 1
        return textResponse(shellHtml())
      }
      seen.push(((init?.headers ?? {}) as Record<string, string>)['x-client-transaction-id'] ?? '')
      return jsonResponse(createdBody('999'))
    })
    expect(await client.replyToTweet({ tweetId: '42', text: 'hi' })).toEqual({ ok: true, tweetId: '999' })
    expect(await client.replyToTweet({ tweetId: '42', text: 'again' })).toEqual({ ok: true, tweetId: '999' })

    expect(seen).toHaveLength(2)
    for (const value of seen) {
      expect(Buffer.from(value, 'base64')).toHaveLength(70)
    }
    // A fresh value per request, from one shell fetch that the store keeps.
    expect(seen[0]).not.toBe(seen[1])
    expect(shellRequests).toBe(1)
  })

  // Losing the header must not lose the reply: reads worked without it before this existed.
  test('still posts the reply when the shell gives no transaction id', async () => {
    let header: string | undefined
    const client = await clientWith(async (input, init) => {
      if (input.toString().endsWith('/home')) {
        return textResponse('<html><head></head><body></body></html>')
      }
      header = ((init?.headers ?? {}) as Record<string, string>)['x-client-transaction-id']
      return jsonResponse(createdBody('999'))
    })
    expect(await client.replyToTweet({ tweetId: '42', text: 'hi' })).toEqual({ ok: true, tweetId: '999' })
    expect(header).toBeUndefined()
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

describe('the composer drawer', () => {
  test('breaks a long draft on a space instead of cutting it', () => {
    expect(composerLines('one two three four', 9)).toEqual(['one two', 'three', 'four'])
  })

  test('keeps the spacing the reader typed', () => {
    expect(composerLines('a  b', 10)).toEqual(['a  b'])
    expect(composerLines('first\n\nlast', 10)).toEqual(['first', '', 'last'])
  })

  test('cuts a word that is wider than the drawer', () => {
    expect(composerLines('x'.repeat(12), 5)).toEqual(['xxxxx', 'xxxxx', 'xx'])
  })

  test('grows a row for every wrapped line', () => {
    expect(composerBody('short', undefined, 40).height).toBe(6)
    expect(composerBody('one two three four', undefined, 9).height).toBe(8)
  })

  test('holds a full 280-character draft in a 40-column window', () => {
    const draft = 'lorem ipsum '.repeat(24).slice(0, 280)
    const drawer = composerBody(draft, undefined, 34)
    expect(drawer.text.split('\n')).toHaveLength(composerTextCap)
    expect(drawer.text).toContain(draft.slice(-20))
  })

  // The reader types at the foot of the draft, so the foot is the part that must stay.
  test('drops the head of a draft that passes the cap', () => {
    const draft = Array.from({ length: 12 }, (_, index) => `line${index}`).join('\n')
    const drawer = composerBody(draft, undefined, 40)
    expect(drawer.height).toBe(composerTextCap + 5)
    expect(drawer.text.split('\n')[0]).toBe('line4')
    expect(drawer.text).not.toContain('line3')
  })

  test('keeps the whole reason under the draft', () => {
    const drawer = composerBody('hi', 'X refused the reply\nThe draft is kept.', 40)
    expect(drawer.text.split('\n')).toEqual(['hi', '', 'Error: X refused the reply', 'The draft is kept.'])
    expect(drawer.height).toBe(9)
  })

  test('never grows past the cap, however long the reason', () => {
    const drawer = composerBody('hi', 'a'.repeat(400), 20)
    expect(drawer.text.split('\n').length).toBe(composerTextCap)
    expect(drawer.height).toBe(composerTextCap + 5)
  })

  test('shows the prompt while the draft is empty', () => {
    expect(composerBody('', undefined, 40).text).toBe('Start typing…')
  })
})

describe('a failed reply on screen', () => {
  test('shows the automation gate code and keeps the draft', () => {
    const failure = replyFailure({ error: 'This request looks like it might be automated.', code: 226 }, '/tmp/tweeter.log')
    expect(failure.error).toContain('code 226')
    expect(failure.error).toContain('The draft is kept')
    expect(failure.error).toContain('/tmp/tweeter.log')
    // mainScreen paints the status red on this word, so a failure never reads as a success.
    expect(failure.status).toContain('failed')
  })

  test('still says what happened when X gives no code', () => {
    const failure = replyFailure({ error: 'X refused the reply and gave no reason' }, '/tmp/tweeter.log')
    expect(failure.error).toStartWith('X refused the reply and gave no reason\n')
    expect(failure.status).toBe('reply failed (no code); log: /tmp/tweeter.log')
  })
})
