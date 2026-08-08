import { randomUUID } from 'node:crypto'
import { bearerToken, defaultUserAgent } from './constants.ts'

export type HeaderOptions = {
  authToken: string
  ct0: string
  userAgent?: string
  clientUuid?: string
  clientDeviceId?: string
  clientUserId?: string
  cookieHeader?: string
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
    return this.opts.cookieHeader ?? `auth_token=${this.opts.authToken}; ct0=${this.opts.ct0}`
  }

  baseHeaders(options: { authType?: 'OAuth2Session' | 'OAuth2Client'; origin?: string; referer?: string } = {}): Record<string, string> {
    const headers: Record<string, string> = {
      accept: '*/*',
      'accept-language': 'en-US,en;q=0.9',
      authorization: `Bearer ${bearerToken}`,
      'x-csrf-token': this.opts.ct0,
      'x-twitter-auth-type': options.authType ?? 'OAuth2Session',
      'x-twitter-active-user': 'yes',
      'x-twitter-client-language': 'en',
      'x-client-uuid': this.clientUuid,
      'x-twitter-client-deviceid': this.clientDeviceId,
      // x-client-transaction-id is added per request by GraphQLClient, because its value
      // covers the path and the method. See transactionId.ts.
      cookie: this.cookieHeader(),
      'user-agent': this.opts.userAgent ?? defaultUserAgent,
      origin: options.origin ?? 'https://x.com',
      referer: options.referer ?? 'https://x.com/',
      // Reads pass without these. A write does not: X answers a request that omits the
      // browser fingerprint headers with error 226, "this request looks automated".
      'sec-ch-ua': '"Chromium";v="146", "Not_A Brand";v="24", "Google Chrome";v="146"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"macOS"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      priority: 'u=1, i'
    }
    if (this.clientUserId) {
      headers['x-twitter-client-user-id'] = this.clientUserId
    }
    return headers
  }

  jsonHeaders(options: { authType?: 'OAuth2Session' | 'OAuth2Client'; origin?: string; referer?: string } = {}): Record<string, string> {
    return { ...this.baseHeaders(options), 'content-type': 'application/json' }
  }

  // The follow endpoints are the old REST API, which takes a form body rather than JSON.
  formHeaders(options: { origin?: string; referer?: string } = {}): Record<string, string> {
    return { ...this.baseHeaders(options), 'content-type': 'application/x-www-form-urlencoded' }
  }

  // Fetching the app shell needs the cookie and nothing else. The API headers would make
  // x.com answer with JSON instead of the HTML that lists the script bundles.
  htmlHeaders(): Record<string, string> {
    return {
      accept: 'text/html,application/xhtml+xml',
      'accept-language': 'en-US,en;q=0.9',
      cookie: this.cookieHeader(),
      'user-agent': this.opts.userAgent ?? defaultUserAgent
    }
  }
}
