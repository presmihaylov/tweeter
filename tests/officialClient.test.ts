import { describe, expect, test } from 'bun:test'
import { OfficialXApiClient, v2TweetsEndpoint } from '../src/twitter/officialClient.ts'
import { tokenEndpoint } from '../src/twitter/oauth/tokens.ts'
import type { XApiTokens } from '../src/config/schema.ts'
import { jsonResponse } from './helpers.ts'

const baseTokens = (overrides: Partial<XApiTokens> = {}): XApiTokens => ({
  clientId: 'CLIENT',
  accessToken: 'ACCESS',
  refreshToken: 'REFRESH',
  expiresAt: 10_000_000_000,
  scope: 'tweet.read tweet.write users.read offline.access',
  ...overrides
})

describe('OfficialXApiClient', () => {
  test('reply posts to /2/tweets with bearer + reply field', async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = []
    const fetchMock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      seen.push({ url: input.toString(), init })
      return jsonResponse({ data: { id: '12345', text: 'hi' } })
    }
    const client = new OfficialXApiClient({ tokens: baseTokens(), fetch: fetchMock, now: () => 1_000_000 })
    const result = await client.reply({ tweetId: '999', text: 'hi' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.tweetId).toBe('12345')
    }
    expect(seen).toHaveLength(1)
    expect(seen[0]?.url).toBe(v2TweetsEndpoint)
    const init = seen[0]?.init
    const headers = init?.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer ACCESS')
    expect(headers['content-type']).toBe('application/json')
    const body = JSON.parse(init?.body as string) as { text: string; reply?: { in_reply_to_tweet_id: string } }
    expect(body.text).toBe('hi')
    expect(body.reply?.in_reply_to_tweet_id).toBe('999')
  })

  test('tweet posts to /2/tweets without reply field', async () => {
    let capturedBody: unknown
    const fetchMock = async (_: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      capturedBody = JSON.parse(init?.body as string)
      return jsonResponse({ data: { id: 'abc' } })
    }
    const client = new OfficialXApiClient({ tokens: baseTokens(), fetch: fetchMock, now: () => 1_000_000 })
    const result = await client.tweet('hello world')
    expect(result.ok).toBe(true)
    expect(capturedBody).toEqual({ text: 'hello world' })
  })

  test('returns rate-limit error for 429', async () => {
    const fetchMock = async (): Promise<Response> => {
      return new Response(JSON.stringify({ title: 'Too Many Requests', detail: 'You have reached your limit' }), { status: 429, headers: { 'content-type': 'application/json' } })
    }
    const client = new OfficialXApiClient({ tokens: baseTokens(), fetch: fetchMock, now: () => 1_000_000 })
    const result = await client.tweet('hi')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(429)
      expect(result.error).toContain('You have reached your limit')
    }
  })

  test('refreshes tokens on 401, retries the post, and persists', async () => {
    let postAttempts = 0
    let tokenCalls = 0
    let persistedAccess: string | undefined
    const fetchMock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = input.toString()
      if (url === tokenEndpoint) {
        tokenCalls += 1
        const body = init?.body as string
        expect(body).toContain('grant_type=refresh_token')
        expect(body).toContain('refresh_token=REFRESH')
        return jsonResponse({ access_token: 'NEW_ACCESS', refresh_token: 'NEW_REFRESH', expires_in: 7200, scope: 'tweet.read tweet.write' })
      }
      if (url === v2TweetsEndpoint) {
        postAttempts += 1
        const headers = init?.headers as Record<string, string>
        if (postAttempts === 1) {
          expect(headers.authorization).toBe('Bearer ACCESS')
          return jsonResponse({ title: 'Unauthorized' }, { status: 401 })
        }
        expect(headers.authorization).toBe('Bearer NEW_ACCESS')
        return jsonResponse({ data: { id: '777' } })
      }
      return jsonResponse({}, { status: 404 })
    }
    const client = new OfficialXApiClient({
      tokens: baseTokens(),
      fetch: fetchMock,
      now: () => 1_000_000,
      onTokensRefreshed: async (next) => { persistedAccess = next.accessToken }
    })
    const result = await client.reply({ tweetId: '1', text: 'r' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.tweetId).toBe('777')
    }
    expect(postAttempts).toBe(2)
    expect(tokenCalls).toBe(1)
    expect(persistedAccess).toBe('NEW_ACCESS')
    expect(client.currentTokens().accessToken).toBe('NEW_ACCESS')
    expect(client.currentTokens().refreshToken).toBe('NEW_REFRESH')
  })

  test('refreshes proactively when token is near expiry', async () => {
    let tokenCalls = 0
    const fetchMock = async (input: RequestInfo | URL): Promise<Response> => {
      const url = input.toString()
      if (url === tokenEndpoint) {
        tokenCalls += 1
        return jsonResponse({ access_token: 'FRESH', refresh_token: 'FRESH_REF', expires_in: 7200 })
      }
      return jsonResponse({ data: { id: '1' } })
    }
    const now = 1_000_000_000
    const tokens = baseTokens({ expiresAt: now + 5_000 })
    const client = new OfficialXApiClient({ tokens, fetch: fetchMock, now: () => now, refreshSkewMs: 60_000 })
    await client.tweet('hi')
    expect(tokenCalls).toBe(1)
    expect(client.currentTokens().accessToken).toBe('FRESH')
  })

  test('returns explicit error when refresh itself fails', async () => {
    const fetchMock = async (input: RequestInfo | URL): Promise<Response> => {
      const url = input.toString()
      if (url === tokenEndpoint) {
        return jsonResponse({ error: 'invalid_grant', error_description: 'refresh token revoked' }, { status: 400 })
      }
      return jsonResponse({ title: 'Unauthorized' }, { status: 401 })
    }
    const client = new OfficialXApiClient({ tokens: baseTokens(), fetch: fetchMock, now: () => 1_000_000 })
    const result = await client.reply({ tweetId: '1', text: 'r' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(401)
      expect(result.error).toContain('refresh failed')
      expect(result.error).toContain('refresh token revoked')
    }
  })
})
