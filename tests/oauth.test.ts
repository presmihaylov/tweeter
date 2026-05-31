import { describe, expect, test } from 'bun:test'
import { base64UrlEncode, buildAuthorizeUrl, createPkcePair } from '../src/twitter/oauth/pkce.ts'
import { exchangeCodeForTokens, refreshTokens, tokenEndpoint, tokensFromExchange } from '../src/twitter/oauth/tokens.ts'
import { runAuthorizeFlow } from '../src/auth/twitterAuthFlow.ts'
import type { LoopbackHandle } from '../src/twitter/oauth/loopback.ts'
import { jsonResponse } from './helpers.ts'

describe('PKCE helpers', () => {
  test('base64UrlEncode strips padding and uses url-safe chars', () => {
    expect(base64UrlEncode(Buffer.from([0xff, 0xff, 0xfe]))).toBe('___-')
    expect(base64UrlEncode(Buffer.from('a'))).toBe('YQ')
  })

  test('createPkcePair derives a sha256 S256 challenge', () => {
    const counter = { i: 0 }
    const rand = (size: number): Buffer => {
      counter.i += 1
      return Buffer.alloc(size, counter.i)
    }
    const pair = createPkcePair(rand)
    expect(pair.codeVerifier.length).toBeGreaterThan(20)
    expect(pair.codeChallenge.length).toBeGreaterThan(20)
    expect(pair.state.length).toBeGreaterThan(10)
    expect(pair.codeChallenge).not.toBe(pair.codeVerifier)
  })

  test('buildAuthorizeUrl includes the expected query parameters', () => {
    const url = buildAuthorizeUrl({
      clientId: 'C',
      redirectUri: 'http://127.0.0.1:9999/callback',
      scope: 'tweet.read tweet.write',
      state: 'S',
      codeChallenge: 'CC'
    })
    const parsed = new URL(url)
    expect(parsed.origin + parsed.pathname).toBe('https://x.com/i/oauth2/authorize')
    expect(parsed.searchParams.get('response_type')).toBe('code')
    expect(parsed.searchParams.get('client_id')).toBe('C')
    expect(parsed.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:9999/callback')
    expect(parsed.searchParams.get('scope')).toBe('tweet.read tweet.write')
    expect(parsed.searchParams.get('state')).toBe('S')
    expect(parsed.searchParams.get('code_challenge')).toBe('CC')
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256')
  })
})

describe('OAuth token endpoint', () => {
  test('exchangeCodeForTokens posts form-encoded body and parses response', async () => {
    let capturedBody: string | undefined
    const fetchMock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      expect(input.toString()).toBe(tokenEndpoint)
      expect((init?.headers as Record<string, string>)['content-type']).toBe('application/x-www-form-urlencoded')
      capturedBody = init?.body as string
      return jsonResponse({ access_token: 'A', refresh_token: 'R', expires_in: 7200, scope: 'tweet.read' })
    }
    const result = await exchangeCodeForTokens({ clientId: 'C', code: 'CODE', codeVerifier: 'V', redirectUri: 'http://127.0.0.1:1/callback', fetch: fetchMock })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.accessToken).toBe('A')
      expect(result.refreshToken).toBe('R')
      expect(result.expiresIn).toBe(7200)
      expect(result.scope).toBe('tweet.read')
    }
    const params = new URLSearchParams(capturedBody ?? '')
    expect(params.get('grant_type')).toBe('authorization_code')
    expect(params.get('code')).toBe('CODE')
    expect(params.get('code_verifier')).toBe('V')
    expect(params.get('client_id')).toBe('C')
    expect(params.get('redirect_uri')).toBe('http://127.0.0.1:1/callback')
  })

  test('refreshTokens posts grant_type=refresh_token', async () => {
    let capturedBody: string | undefined
    const fetchMock = async (_: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      capturedBody = init?.body as string
      return jsonResponse({ access_token: 'A2', refresh_token: 'R2', expires_in: 7200 })
    }
    const result = await refreshTokens({ clientId: 'C', refreshToken: 'OLD', fetch: fetchMock })
    expect(result.ok).toBe(true)
    const params = new URLSearchParams(capturedBody ?? '')
    expect(params.get('grant_type')).toBe('refresh_token')
    expect(params.get('refresh_token')).toBe('OLD')
    expect(params.get('client_id')).toBe('C')
  })

  test('returns error for non-OK response', async () => {
    const fetchMock = async (): Promise<Response> => jsonResponse({ error: 'invalid_request', error_description: 'bad code' }, { status: 400 })
    const result = await exchangeCodeForTokens({ clientId: 'C', code: 'X', codeVerifier: 'V', redirectUri: 'r', fetch: fetchMock })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('bad code')
    }
  })

  test('tokensFromExchange builds XApiTokens with expiry derived from now + expires_in', () => {
    const tokens = tokensFromExchange('C', { ok: true, accessToken: 'A', refreshToken: 'R', expiresIn: 100, scope: 's' }, 1_000_000)
    expect(tokens.clientId).toBe('C')
    expect(tokens.expiresAt).toBe(1_000_000 + 100_000)
    expect(tokens.scope).toBe('s')
  })
})

describe('runAuthorizeFlow', () => {
  const buildFakeServer = (callback: { ok: true; code: string; state: string } | { ok: false; error: string }): LoopbackHandle => ({
    redirectUri: 'http://127.0.0.1:12345/callback',
    port: 12345,
    waitForCallback: async () => callback,
    close: async () => {}
  })

  test('happy path: opens URL, exchanges code, returns tokens', async () => {
    let openedUrl: string | undefined
    let exchangeBody: string | undefined
    const fetchMock = async (_: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      exchangeBody = init?.body as string
      return jsonResponse({ access_token: 'A', refresh_token: 'R', expires_in: 7200, scope: 'tweet.read tweet.write' })
    }
    let resolveServerState: (value: string) => void = () => {}
    const statePromise = new Promise<string>((resolve) => { resolveServerState = resolve })
    const fakeServer: LoopbackHandle = {
      redirectUri: 'http://127.0.0.1:12345/callback',
      port: 12345,
      waitForCallback: async () => ({ ok: true, code: 'CODE', state: await statePromise }),
      close: async () => {}
    }
    const result = await runAuthorizeFlow({
      clientId: 'C',
      fetch: fetchMock,
      now: () => 1000,
      startServer: async () => fakeServer,
      openBrowser: (url) => { openedUrl = url },
      onUrl: (url) => {
        openedUrl = url
        const params = new URL(url).searchParams
        resolveServerState(params.get('state') ?? '')
      }
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.tokens.accessToken).toBe('A')
      expect(result.tokens.expiresAt).toBe(1000 + 7200_000)
      expect(result.tokens.clientId).toBe('C')
    }
    expect(openedUrl).toContain('https://x.com/i/oauth2/authorize')
    const params = new URLSearchParams(exchangeBody ?? '')
    expect(params.get('code')).toBe('CODE')
  })

  test('rejects mismatched state (CSRF guard)', async () => {
    const fetchMock = async (): Promise<Response> => jsonResponse({})
    const result = await runAuthorizeFlow({
      clientId: 'C',
      fetch: fetchMock,
      startServer: async () => buildFakeServer({ ok: true, code: 'CODE', state: 'WRONG_STATE' })
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('state mismatch')
    }
  })

  test('propagates callback errors (e.g. user denied)', async () => {
    const fetchMock = async (): Promise<Response> => jsonResponse({})
    const result = await runAuthorizeFlow({
      clientId: 'C',
      fetch: fetchMock,
      startServer: async () => buildFakeServer({ ok: false, error: 'access_denied' })
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('access_denied')
    }
  })
})
