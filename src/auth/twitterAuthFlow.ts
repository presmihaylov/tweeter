import type { Fetcher } from '../utils/fetcher.ts'
import type { XApiTokens } from '../config/schema.ts'
import { buildAuthorizeUrl, createPkcePair } from '../twitter/oauth/pkce.ts'
import { startLoopbackServer, type LoopbackHandle } from '../twitter/oauth/loopback.ts'
import { exchangeCodeForTokens, tokensFromExchange } from '../twitter/oauth/tokens.ts'

export const defaultOAuthScopes = 'tweet.read tweet.write users.read offline.access'

export type AuthorizeArgs = {
  clientId: string
  scope?: string
  fetch?: Fetcher
  now?: () => number
  startServer?: (path?: string, port?: number) => Promise<LoopbackHandle>
  openBrowser?: (url: string) => Promise<void> | void
  onUrl?: (url: string) => void
  port?: number
}

export type AuthorizeResult =
  | { ok: true; tokens: XApiTokens }
  | { ok: false; error: string }

export const runAuthorizeFlow = async (args: AuthorizeArgs): Promise<AuthorizeResult> => {
  const scope = args.scope ?? defaultOAuthScopes
  const startServer = args.startServer ?? startLoopbackServer
  const server = await startServer('/callback', args.port ?? 0)
  try {
    const pkce = createPkcePair()
    const authorizeUrl = buildAuthorizeUrl({
      clientId: args.clientId,
      redirectUri: server.redirectUri,
      scope,
      state: pkce.state,
      codeChallenge: pkce.codeChallenge
    })
    if (args.onUrl) {
      args.onUrl(authorizeUrl)
    }
    if (args.openBrowser) {
      try {
        await args.openBrowser(authorizeUrl)
      } catch {
        // Browser launch is best-effort; user can paste the URL manually.
      }
    }
    const callback = await server.waitForCallback()
    if (!callback.ok) {
      return { ok: false, error: callback.error }
    }
    if (callback.state !== pkce.state) {
      return { ok: false, error: 'OAuth state mismatch; possible CSRF, restart auth flow' }
    }
    const exchange = await exchangeCodeForTokens({
      clientId: args.clientId,
      code: callback.code,
      codeVerifier: pkce.codeVerifier,
      redirectUri: server.redirectUri,
      fetch: args.fetch
    })
    if (!exchange.ok) {
      return { ok: false, error: exchange.error }
    }
    const now = (args.now ?? (() => Date.now()))()
    return { ok: true, tokens: tokensFromExchange(args.clientId, exchange, now) }
  } finally {
    await server.close()
  }
}
