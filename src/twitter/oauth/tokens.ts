import { defaultFetcher, type Fetcher } from '../../utils/fetcher.ts'
import { getStr, isRecord } from '../../utils/guards.ts'
import type { XApiTokens } from '../../config/schema.ts'

export const tokenEndpoint = 'https://api.x.com/2/oauth2/token'

export type TokenExchangeResult =
  | { ok: true; accessToken: string; refreshToken: string; expiresIn: number; scope?: string }
  | { ok: false; error: string }

export const exchangeCodeForTokens = async (args: {
  clientId: string
  code: string
  codeVerifier: string
  redirectUri: string
  fetch?: Fetcher
}): Promise<TokenExchangeResult> => {
  const fetchImpl = args.fetch ?? defaultFetcher
  const body = new URLSearchParams({
    code: args.code,
    grant_type: 'authorization_code',
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    code_verifier: args.codeVerifier
  })
  return postTokenRequest(fetchImpl, body)
}

export const refreshTokens = async (args: {
  clientId: string
  refreshToken: string
  fetch?: Fetcher
}): Promise<TokenExchangeResult> => {
  const fetchImpl = args.fetch ?? defaultFetcher
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: args.refreshToken,
    client_id: args.clientId
  })
  return postTokenRequest(fetchImpl, body)
}

const postTokenRequest = async (fetchImpl: Fetcher, body: URLSearchParams): Promise<TokenExchangeResult> => {
  let response: Response
  try {
    response = await fetchImpl(tokenEndpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json'
      },
      body: body.toString()
    })
  } catch (error) {
    return { ok: false, error: `token request failed: ${error instanceof Error ? error.message : 'network error'}` }
  }
  const text = await response.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    return { ok: false, error: `token endpoint returned non-JSON (status ${response.status}): ${text.slice(0, 200)}` }
  }
  if (!response.ok || !isRecord(parsed)) {
    const description = isRecord(parsed) ? getStr(parsed, 'error_description') || getStr(parsed, 'error') : ''
    return { ok: false, error: `token endpoint error (status ${response.status}): ${description || text.slice(0, 200)}` }
  }
  const accessToken = getStr(parsed, 'access_token')
  const refreshToken = getStr(parsed, 'refresh_token')
  const expiresInRaw = parsed.expires_in
  const expiresIn = typeof expiresInRaw === 'number' ? Math.trunc(expiresInRaw) : 0
  if (accessToken === '' || refreshToken === '' || expiresIn <= 0) {
    return { ok: false, error: `token endpoint response missing fields: ${text.slice(0, 200)}` }
  }
  return {
    ok: true,
    accessToken,
    refreshToken,
    expiresIn,
    scope: getStr(parsed, 'scope') || undefined
  }
}

export const tokensFromExchange = (clientId: string, result: Extract<TokenExchangeResult, { ok: true }>, now: number, existing?: { userId?: string; username?: string }): XApiTokens => {
  return {
    clientId,
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    expiresAt: now + result.expiresIn * 1000,
    scope: result.scope,
    userId: existing?.userId,
    username: existing?.username
  }
}
