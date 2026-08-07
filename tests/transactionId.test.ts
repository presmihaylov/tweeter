import { describe, expect, test } from 'bun:test'
import fixture from './fixtures/transactionId.json' with { type: 'json' }
import { shellHtml } from './helpers.ts'
import { PageContextStore } from '../src/twitter/pageContext.ts'
import {
  computeAnimationKey,
  extractAnimationPath,
  formatMatrixNumber,
  generateTransactionId,
  parseAnimationFrames,
  parsePageContext,
  transactionPathOf
} from '../src/twitter/transactionId.ts'

// Every id in the fixture came out of the real x.com generator in a live Chrome, on pages
// nobody was signed in to. A verification key belongs to one HTML response and rotates on
// the next, so the file carries no credential. The port has to reproduce all of them.
const animationPaths = fixture.animSvgs

describe('x-client-transaction-id', () => {
  test('reproduces every id the real x.com generator produced', () => {
    const failures: string[] = []
    for (const one of fixture.cases) {
      const raw = Buffer.from(one.id, 'base64')
      const mask = raw[0] ?? 0
      const seconds = Buffer.from(raw.subarray(49, 53).map((byte) => byte ^ mask)).readUInt32LE(0)
      const mine = generateTransactionId({
        path: one.path,
        method: one.method,
        page: { verificationKey: one.verificationKey, animationPaths },
        nowMs: (seconds + 1682924400) * 1000,
        maskByte: mask
      })
      if (mine !== one.id) {
        failures.push(`${one.method} ${one.path}`)
      }
    }
    expect(failures).toEqual([])
    expect(fixture.cases.length).toBeGreaterThan(50)
  })

  test('decodes to 70 bytes with the key, the clock and the trailer in place', () => {
    const one = fixture.cases[0]
    expect(one).toBeDefined()
    const page = { verificationKey: one?.verificationKey ?? '', animationPaths }
    const nowMs = 1786012021000
    const raw = Buffer.from(generateTransactionId({ path: '/i/api/graphql/abc/CreateTweet', method: 'POST', page, nowMs, maskByte: 0 }), 'base64')

    expect(raw.length).toBe(70)
    expect(raw.subarray(1, 49).toString('base64')).toBe(page.verificationKey)
    expect(raw.readUInt32LE(49)).toBe(Math.floor(nowMs / 1000) - 1682924400)
    expect(raw[69]).toBe(3)
  })

  test('masks every byte after the first with the first', () => {
    const page = { verificationKey: fixture.cases[0]?.verificationKey ?? '', animationPaths }
    const plain = Buffer.from(generateTransactionId({ path: '/x', method: 'GET', page, nowMs: 1786012021000, maskByte: 0 }), 'base64')
    const masked = Buffer.from(generateTransactionId({ path: '/x', method: 'GET', page, nowMs: 1786012021000, maskByte: 0xa7 }), 'base64')

    expect(masked[0]).toBe(0xa7)
    for (let index = 1; index < plain.length; index += 1) {
      expect(masked[index]).toBe((plain[index] ?? 0) ^ 0xa7)
    }
  })

  test('gives a different id for the same request every time', () => {
    const page = { verificationKey: fixture.cases[0]?.verificationKey ?? '', animationPaths }
    const ids = new Set(Array.from({ length: 20 }, () => generateTransactionId({ path: '/a', method: 'POST', page })))
    expect(ids.size).toBeGreaterThan(1)
  })

  test('the method and the path both change the digest', () => {
    const page = { verificationKey: fixture.cases[0]?.verificationKey ?? '', animationPaths }
    const digest = (path: string, method: string): string =>
      Buffer.from(generateTransactionId({ path, method, page, nowMs: 1786012021000, maskByte: 0 }), 'base64').subarray(53, 69).toString('hex')

    expect(digest('/a', 'POST')).not.toBe(digest('/b', 'POST'))
    expect(digest('/a', 'POST')).not.toBe(digest('/a', 'GET'))
  })

  test('refuses a key that is not 48 bytes instead of sending a short header', () => {
    expect(() => generateTransactionId({ path: '/a', method: 'GET', page: { verificationKey: 'YWJj', animationPaths } }))
      .toThrow('decodes to 3 bytes, expected 48')
  })

  test('parses the animation frames as 16 rows of 11 numbers', () => {
    for (const svg of animationPaths) {
      const rows = parseAnimationFrames(extractAnimationPath(svg))
      expect(rows.length).toBe(16)
      for (const row of rows) {
        expect(row.length).toBe(11)
      }
    }
  })

  // X moved these three byte groups when it shipped a new ondemand.s bundle, and every
  // request we signed with the old ones failed. This pins where they sit now.
  test('picks the animation, the frame and the pause from bytes 5, 12 and 1/28/29', () => {
    const base = Buffer.alloc(48)
    base[5] = 2
    base[12] = 9
    base[1] = 5
    base[28] = 7
    base[29] = 3
    const keyOf = (change: (bytes: Buffer) => void): string => {
      const bytes = Buffer.from(base)
      change(bytes)
      return computeAnimationKey(new Uint8Array(bytes), animationPaths)
    }
    const first = keyOf(() => undefined)

    for (const index of [5, 12, 1, 28, 29]) {
      expect(keyOf((bytes) => { bytes[index] = (base[index] ?? 0) + 1 })).not.toBe(first)
    }
    // The bytes the old bundle read. They must not move the key any more.
    for (const index of [7, 2, 30, 47]) {
      expect(keyOf((bytes) => { bytes[index] = 11 })).toBe(first)
    }
  })

  test('formats matrix numbers the way Blink does, not the way JavaScript does', () => {
    expect(formatMatrixNumber(0.0000341315)).toBe('3.41315e-05')
    expect(String(0.0000341315)).toBe('0.0000341315')
    expect(formatMatrixNumber(0.000138995)).toBe('0.000138995')
    expect(formatMatrixNumber(1)).toBe('1')
    expect(formatMatrixNumber(0)).toBe('0')
    expect(formatMatrixNumber(-0)).toBe('0')
    expect(formatMatrixNumber(0.999999)).toBe('0.999999')
  })

  test('drops the query string from the path the way the x.com caller does', () => {
    expect(transactionPathOf('https://x.com/i/api/graphql/abc/CreateTweet?variables=%7B%7D')).toBe('/i/api/graphql/abc/CreateTweet')
    expect(transactionPathOf('/i/api/graphql/abc/CreateTweet')).toBe('/i/api/graphql/abc/CreateTweet')
  })

  test('reads the key and the animations out of a shell, or reports neither', () => {
    const svgs = animationPaths.join('')
    const html = `<html><head><meta name="twitter-site-verification" content="AAAA"></head><body>${svgs}</body></html>`
    const page = parsePageContext(html)
    expect(page?.verificationKey).toBe('AAAA')
    expect(page?.animationPaths.length).toBe(4)

    expect(parsePageContext('<html><head></head><body></body></html>')).toBeUndefined()
    expect(parsePageContext('<meta name="twitter-site-verification" content="AAAA">')).toBeUndefined()
  })
})

describe('the page context store', () => {
  const shell = (): Response => new Response(shellHtml(), { status: 200 })

  test('fetches the shell once and answers every later call from memory', async () => {
    let fetches = 0
    const store = new PageContextStore('https://x.com', async () => { fetches += 1; return shell() })
    const [first, second] = await Promise.all([store.get(), store.get()])

    expect(first?.animationPaths).toHaveLength(4)
    expect(second).toBe(first)
    expect(await store.get()).toBe(first)
    expect(fetches).toBe(1)
  })

  test('refresh replaces the key, because X rotates it per response', async () => {
    let fetches = 0
    const store = new PageContextStore('https://x.com', async () => { fetches += 1; return shell() })
    const first = await store.get()
    const second = await store.refresh()

    expect(second).not.toBe(first)
    expect(second?.verificationKey).toBe(first?.verificationKey ?? '')
    expect(fetches).toBe(2)
  })

  test('falls back to the bare host when /home carries no animations', async () => {
    const asked: string[] = []
    const store = new PageContextStore('https://x.com', async (input) => {
      asked.push(input.toString())
      return input.toString().endsWith('/home') ? new Response('<html></html>', { status: 200 }) : shell()
    })

    expect(await store.get()).toBeDefined()
    expect(asked).toEqual(['https://x.com/home', 'https://x.com'])
  })

  test('waits a minute before it retries a shell it could not read', async () => {
    let fetches = 0
    let clock = 1_000_000
    const store = new PageContextStore('https://x.com', async () => { fetches += 1; return new Response('nope', { status: 500 }) }, undefined, () => clock)

    expect(await store.get()).toBeUndefined()
    expect(fetches).toBe(2)
    expect(await store.get()).toBeUndefined()
    expect(fetches).toBe(2)

    clock += 61_000
    expect(await store.get()).toBeUndefined()
    expect(fetches).toBe(4)
  })

  test('reports nothing rather than throwing when the shell fetch fails', async () => {
    const store = new PageContextStore('https://x.com', async () => { throw new Error('offline') })
    expect(await store.get()).toBeUndefined()
  })
})
