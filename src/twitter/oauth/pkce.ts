import { createHash, randomBytes } from 'node:crypto'

export type PkcePair = {
  codeVerifier: string
  codeChallenge: string
  state: string
}

export const base64UrlEncode = (buf: Buffer): string => {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '')
}

export const createPkcePair = (rand: (size: number) => Buffer = randomBytes): PkcePair => {
  const codeVerifier = base64UrlEncode(rand(32))
  const codeChallenge = base64UrlEncode(createHash('sha256').update(codeVerifier).digest())
  const state = base64UrlEncode(rand(16))
  return { codeVerifier, codeChallenge, state }
}

export const buildAuthorizeUrl = (args: {
  clientId: string
  redirectUri: string
  scope: string
  state: string
  codeChallenge: string
}): string => {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    scope: args.scope,
    state: args.state,
    code_challenge: args.codeChallenge,
    code_challenge_method: 'S256'
  })
  return `https://x.com/i/oauth2/authorize?${params.toString()}`
}
