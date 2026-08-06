import { describe, expect, test } from 'bun:test'
import { retryStatus } from '../src/app/mainScreen.ts'
import { TwitterClient } from '../src/twitter/client.ts'
import { automationRetryDelaysMs, automationWriteCode, transientWriteCode, writeRetryDelaysMs } from '../src/twitter/constants.ts'
import { jsonResponse } from './helpers.ts'
import type { WriteRetryNotice } from '../src/twitter/types.ts'

const refusal = (code: number, message: string): Response =>
  jsonResponse({ data: {}, errors: [{ code, message: `Authorization: ${message} (${code})` }] })

const created = (tweetId: string): Response =>
  jsonResponse({ data: { create_tweet: { tweet_results: { result: { rest_id: tweetId } } } } })

// Every write also fetches the x.com shell to sign itself; only the mutations are scripted.
const clientFor = (answers: Response[], slept: number[]): { client: TwitterClient; calls: string[] } => {
  const calls: string[] = []
  const client = new TwitterClient({
    authToken: 'auth',
    ct0: 'csrf',
    graphQLBase: 'https://x.com/i/api/graphql',
    sleep: async (ms) => { slept.push(ms) },
    fetch: async (input) => {
      const path = new URL(input.toString()).pathname
      if (!path.includes('/graphql/')) {
        return jsonResponse({}, { status: 404 })
      }
      calls.push(path.split('/').pop() ?? '')
      return answers[calls.length - 1] ?? jsonResponse({}, { status: 500 })
    }
  })
  return { client, calls }
}

describe('the retry on a refused write', () => {
  test('asks again on 344 and reports the reply that finally lands', async () => {
    const slept: number[] = []
    const notices: WriteRetryNotice[] = []
    const { client, calls } = clientFor([
      refusal(transientWriteCode, 'You have reached your daily limit for sending Tweets and messages.'),
      refusal(transientWriteCode, 'You have reached your daily limit for sending Tweets and messages.'),
      created('99')
    ], slept)
    const result = await client.replyToTweet({ tweetId: '10', text: 'hi', onRetry: (notice) => notices.push(notice) })
    expect(result).toEqual({ ok: true, tweetId: '99' })
    expect(calls).toEqual(['CreateTweet', 'CreateTweet', 'CreateTweet'])
    expect(slept).toEqual(writeRetryDelaysMs.slice(0, 2))
    expect(notices.map((notice) => notice.attempt)).toEqual([1, 2])
    expect(notices[0]).toEqual({ attempt: 1, attempts: 3, delayMs: 1000, code: 344 })
  })

  test('gives up after the last delay and hands the refusal back', async () => {
    const slept: number[] = []
    const message = 'You have reached your daily limit for sending Tweets and messages.'
    const { client, calls } = clientFor(Array.from({ length: 4 }, () => refusal(transientWriteCode, message)), slept)
    const result = await client.replyToTweet({ tweetId: '10', text: 'hi' })
    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ code: transientWriteCode })
    // One attempt more than there are delays, and no wait after the last one.
    expect(calls.length).toBe(writeRetryDelaysMs.length + 1)
    expect(slept).toEqual([...writeRetryDelaysMs])
  })

  test('does not repeat a refusal that says something else', async () => {
    const slept: number[] = []
    const { client, calls } = clientFor([refusal(88, 'Rate limit exceeded.')], slept)
    const result = await client.replyToTweet({ tweetId: '10', text: 'hi' })
    expect(result).toMatchObject({ ok: false, code: 88 })
    expect(calls.length).toBe(1)
    expect(slept).toEqual([])
  })

  test('does not repeat a reply that landed', async () => {
    const slept: number[] = []
    const { client, calls } = clientFor([created('99')], slept)
    expect(await client.replyToTweet({ tweetId: '10', text: 'hi' })).toEqual({ ok: true, tweetId: '99' })
    expect(calls.length).toBe(1)
    expect(slept).toEqual([])
  })

  test('covers the like the same way', async () => {
    const slept: number[] = []
    const { client, calls } = clientFor([
      refusal(transientWriteCode, 'You have reached your daily limit for sending Tweets and messages.'),
      jsonResponse({ data: { favorite_tweet: 'Done' } })
    ], slept)
    expect(await client.setLike({ tweetId: '10', liked: true })).toEqual({ ok: true })
    expect(calls).toEqual(['FavoriteTweet', 'FavoriteTweet'])
    expect(slept).toEqual(writeRetryDelaysMs.slice(0, 1))
  })

  test('says what the TUI does rather than repeat the wrong reason from X', () => {
    expect(retryStatus('reply', { attempt: 2, attempts: 3, delayMs: 2500, code: 344 }))
      .toBe('X refused the reply (code 344); retry 2 of 3 in 2.5s')
  })

  test('a whole delay keeps whole seconds on the screen', () => {
    expect(retryStatus('reply', { attempt: 5, attempts: 5, delayMs: 120_000, code: automationWriteCode }))
      .toBe('X refused the reply (code 226); retry 5 of 5 in 120s')
  })
})

describe('the retry on the automation gate', () => {
  const message = 'This request looks like it might be automated. Please try again later.'

  test('asks again five times, on a longer ladder than 344', async () => {
    const slept: number[] = []
    const notices: WriteRetryNotice[] = []
    const { client, calls } = clientFor([
      refusal(automationWriteCode, message),
      refusal(automationWriteCode, message),
      created('99')
    ], slept)
    const result = await client.replyToTweet({ tweetId: '10', text: 'hi', onRetry: (notice) => notices.push(notice) })
    expect(result).toEqual({ ok: true, tweetId: '99' })
    expect(calls.length).toBe(3)
    expect(slept).toEqual(automationRetryDelaysMs.slice(0, 2))
    expect(notices[0]).toEqual({ attempt: 1, attempts: 5, delayMs: 5_000, code: automationWriteCode })
  })

  test('gives up after the fifth delay and keeps the refusal', async () => {
    const slept: number[] = []
    const { client, calls } = clientFor(Array.from({ length: 6 }, () => refusal(automationWriteCode, message)), slept)
    const result = await client.replyToTweet({ tweetId: '10', text: 'hi' })
    expect(result).toMatchObject({ ok: false, code: automationWriteCode })
    expect(calls.length).toBe(automationRetryDelaysMs.length + 1)
    expect(slept).toEqual([...automationRetryDelaysMs])
  })

  // A live run started on 344 and ended on 226, so one ladder must not spend the other.
  test('each code counts its own attempts', async () => {
    const slept: number[] = []
    const { client } = clientFor([
      refusal(transientWriteCode, 'You have reached your daily limit for sending Tweets and messages.'),
      refusal(automationWriteCode, message),
      created('99')
    ], slept)
    expect(await client.replyToTweet({ tweetId: '10', text: 'hi' })).toEqual({ ok: true, tweetId: '99' })
    expect(slept).toEqual([...writeRetryDelaysMs.slice(0, 1), ...automationRetryDelaysMs.slice(0, 1)])
  })
})
