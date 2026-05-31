import { randomBytes, randomUUID } from 'node:crypto'
import { bearerToken, defaultUserAgent } from './constants.ts'

export type HeaderOptions = {
  authToken: string
  ct0: string
  userAgent?: string
  clientUuid?: string
  clientDeviceId?: string
  clientUserId?: string
}

export class HeaderBuilder {
  readonly clientUuid: string
  readonly clientDeviceId: string
  private clientUserId?: string

  constructor(private readonly opts: HeaderOptions) {
    this.clientUuid = opts.clientUuid ?? randomUUID()
    this.clientDeviceId = opts.clientDeviceId ?? randomUUID()
    this.clientUserId = opts.clientUserId
  }

  setClientUserId(userId: string): void {
    this.clientUserId = userId
  }

  cookieHeader(): string {
    return `auth_token=${this.opts.authToken}; ct0=${this.opts.ct0}`
  }

  baseHeaders(): HeadersInit {
    const headers: Record<string, string> = {
      accept: '*/*',
      'accept-language': 'en-US,en;q=0.9',
      authorization: `Bearer ${bearerToken}`,
      'x-csrf-token': this.opts.ct0,
      'x-twitter-auth-type': 'OAuth2Session',
      'x-twitter-active-user': 'yes',
      'x-twitter-client-language': 'en',
      'x-client-uuid': this.clientUuid,
      'x-twitter-client-deviceid': this.clientDeviceId,
      'x-client-transaction-id': randomBytes(16).toString('hex'),
      cookie: this.cookieHeader(),
      'user-agent': this.opts.userAgent ?? defaultUserAgent,
      origin: 'https://x.com',
      referer: 'https://x.com/'
    }
    if (this.clientUserId) {
      headers['x-twitter-client-user-id'] = this.clientUserId
    }
    return headers
  }

  jsonHeaders(): HeadersInit {
    return { ...this.baseHeaders(), 'content-type': 'application/json' }
  }
}
