import { describe, expect, test } from 'bun:test'
import { parsePublishArgs, parseTweetRef, runPublish, UsageError, type Publisher } from '../src/headless/publish.ts'
import type { PostResult } from '../src/twitter/types.ts'

const publisher = (result: PostResult, calls: { text?: string; tweetId?: string }[] = []): Publisher => ({
  postTweet: async ({ text }) => {
    calls.push({ text })
    return result
  },
  replyToTweet: async ({ text, tweetId }) => {
    calls.push({ text, tweetId })
    return result
  }
})

const parsed = (out: string): Record<string, unknown> => JSON.parse(out) as Record<string, unknown>

describe('publish arguments', () => {
  test('takes a bare id, a status URL, or nothing usable', () => {
    expect(parseTweetRef('1234')).toBe('1234')
    expect(parseTweetRef('https://x.com/alice/status/1234?s=20')).toBe('1234')
    expect(parseTweetRef('https://x.com/alice')).toBeUndefined()
  })

  test('a reply needs a target and every command needs text', () => {
    expect(() => parsePublishArgs('reply', ['--text', 'hi'])).toThrow(UsageError)
    expect(() => parsePublishArgs('post', ['--dry-run'])).toThrow(UsageError)
    expect(() => parsePublishArgs('post', ['--text', 'a', '--text-file', 'b'])).toThrow(UsageError)
    expect(() => parsePublishArgs('post', ['--text'])).toThrow(UsageError)
    expect(() => parsePublishArgs('post', ['--text', 'a', '--wat'])).toThrow(UsageError)
  })

  test('--help wins before the required flags are checked', () => {
    expect(parsePublishArgs('reply', ['--help']).help).toBe(true)
  })
})

describe('a headless post', () => {
  test('prints the id and a resolvable URL, and exits 0', async () => {
    const calls: { text?: string }[] = []
    const outcome = await runPublish(
      parsePublishArgs('post', ['--text', 'good morning']),
      'good morning',
      publisher({ ok: true, tweetId: '999' }, calls)
    )
    expect(outcome.exitCode).toBe(0)
    expect(parsed(outcome.stdout)).toEqual({ ok: true, command: 'post', tweetId: '999', url: 'https://x.com/i/status/999' })
    expect(calls).toEqual([{ text: 'good morning' }])
  })

  test('a refusal exits 1 and carries the reason X gave', async () => {
    const outcome = await runPublish(
      parsePublishArgs('post', ['--text', 'nope']),
      'nope',
      publisher({ ok: false, error: 'this request looks like it might be automated', code: 226, status: 200 })
    )
    expect(outcome.exitCode).toBe(1)
    expect(parsed(outcome.stdout)).toEqual({
      ok: false,
      command: 'post',
      error: 'this request looks like it might be automated',
      code: 226,
      status: 200
    })
  })

  test('empty text is refused before anything reaches X', async () => {
    const calls: { text?: string }[] = []
    const outcome = await runPublish(parsePublishArgs('post', ['--text', '   ']), '   ', publisher({ ok: true, tweetId: '1' }, calls))
    expect(outcome.exitCode).toBe(2)
    expect(calls).toEqual([])
  })
})

describe('a headless reply', () => {
  test('answers the target tweet and reports it back', async () => {
    const calls: { text?: string; tweetId?: string }[] = []
    const outcome = await runPublish(
      parsePublishArgs('reply', ['--to', 'https://x.com/alice/status/42', '--text', 'agreed']),
      'agreed',
      publisher({ ok: true, tweetId: '77' }, calls)
    )
    expect(outcome.exitCode).toBe(0)
    expect(parsed(outcome.stdout)).toEqual({
      ok: true,
      command: 'reply',
      tweetId: '77',
      url: 'https://x.com/i/status/77',
      inReplyTo: '42'
    })
    expect(calls).toEqual([{ text: 'agreed', tweetId: '42' }])
  })
})

describe('a dry run', () => {
  test('posts nothing and reports the text it would have sent', async () => {
    const calls: { text?: string }[] = []
    const outcome = await runPublish(
      parsePublishArgs('reply', ['--to', '42', '--text', 'agreed', '--dry-run']),
      'agreed',
      publisher({ ok: true, tweetId: '77' }, calls)
    )
    expect(outcome.exitCode).toBe(0)
    expect(parsed(outcome.stdout)).toEqual({ ok: true, command: 'reply', dryRun: true, text: 'agreed', inReplyTo: '42' })
    expect(calls).toEqual([])
  })
})
