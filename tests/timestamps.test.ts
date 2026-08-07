import { describe, expect, test } from 'bun:test'
import { createTestRenderer } from '@opentui/core/testing'
import { createMainScreen, metricsLine, postedPill } from '../src/app/mainScreen.ts'
import { initialAppState, mergeTimelinePage } from '../src/state/store.ts'
import { absoluteTime, parseTweetTime, relativeTime } from '../src/utils/time.ts'
import type { AppTweet } from '../src/twitter/types.ts'

// Built from local parts, so the assertions hold in whatever timezone the test runs.
const at = (year: number, month: number, dayOfMonth: number, hours = 12, minutes = 0): string =>
  new Date(year, month - 1, dayOfMonth, hours, minutes).toISOString()

const now = new Date(2026, 7, 7, 12, 0)

const ago = (ms: number): string => new Date(now.getTime() - ms).toISOString()

const second = 1000
const minute = 60 * second
const hour = 60 * minute
const day = 24 * hour

const tweet = (createdAt: string | undefined, name = 'Alice'): AppTweet => ({
  id: '1',
  text: 'hello',
  author: { handle: 'alice', name, verified: true },
  createdAt,
  media: [],
  metrics: { replies: 4, reposts: 12, likes: 300, views: 9000 }
})

describe('how long ago a tweet was posted', () => {
  test('counts seconds, minutes, hours and days', () => {
    expect(relativeTime(ago(20 * second), now)).toBe('20s')
    expect(relativeTime(ago(5 * minute), now)).toBe('5m')
    expect(relativeTime(ago(3 * hour), now)).toBe('3h')
    expect(relativeTime(ago(2 * day), now)).toBe('2d')
    expect(relativeTime(ago(6 * day), now)).toBe('6d')
  })

  test('says now for a tweet that just landed', () => {
    expect(relativeTime(ago(0), now)).toBe('now')
    expect(relativeTime(ago(2 * second), now)).toBe('now')
  })

  test('a date ahead of the clock is skew, not the future', () => {
    expect(relativeTime(ago(-90 * minute), now)).toBe('now')
  })

  test('gives the calendar day once the gap stops meaning anything', () => {
    expect(relativeTime(at(2026, 7, 30), now)).toBe('Jul 30')
    expect(relativeTime(at(2026, 1, 4), now)).toBe('Jan 4')
  })

  test('adds the year for a tweet from another year', () => {
    expect(relativeTime(at(2024, 3, 9), now)).toBe('Mar 9, 2024')
  })

  test('says nothing when X sent no date', () => {
    expect(relativeTime(undefined, now)).toBe('')
    expect(relativeTime('', now)).toBe('')
    expect(relativeTime('not a date', now)).toBe('')
  })

  test('reads the format X actually sends', () => {
    expect(parseTweetTime('Wed Aug 06 21:14:03 +0000 2026')?.toISOString()).toBe('2026-08-06T21:14:03.000Z')
    expect(parseTweetTime('nonsense')).toBeUndefined()
    expect(parseTweetTime(undefined)).toBeUndefined()
  })
})

describe('the exact clock and date', () => {
  test('reads as a 12-hour clock in the reader timezone', () => {
    expect(absoluteTime(at(2026, 8, 6, 21, 14))).toBe('9:14 PM · Aug 6, 2026')
    expect(absoluteTime(at(2026, 8, 6, 9, 5))).toBe('9:05 AM · Aug 6, 2026')
  })

  test('names both ends of the day without a zero hour', () => {
    expect(absoluteTime(at(2026, 8, 6, 0, 30))).toBe('12:30 AM · Aug 6, 2026')
    expect(absoluteTime(at(2026, 8, 6, 12, 30))).toBe('12:30 PM · Aug 6, 2026')
  })

  test('says nothing when X sent no date', () => {
    expect(absoluteTime(undefined)).toBe('')
  })
})

describe('where the stamp lands', () => {
  // A big view count would push an appended date off the row, so the counts and the date
  // are two cells and only the counts give ground.
  test('the counts line stays the counts alone', () => {
    expect(metricsLine(tweet(at(2026, 8, 6, 21, 14)))).toBe('4 comments   ·   12 reposts   ·   300 likes   ·   9000 views')
  })

  test('the header pill carries its own separator, or nothing at all', () => {
    expect(postedPill(tweet(ago(3 * hour)), now)).toBe('  ·  3h')
    expect(postedPill(tweet(undefined), now)).toBe('')
    expect(postedPill(undefined, now)).toBe('')
  })
})

describe('the stamp on the screen', () => {
  const frameOf = async (posted: AppTweet): Promise<string> => {
    const harness = await createTestRenderer({ width: 174, height: 52 })
    const screen = createMainScreen(harness.renderer, { now: () => now })
    const state = mergeTimelinePage(initialAppState(), 'following', [posted], {})
    // The first pass has no measured pane, so the row budget only lands on the second.
    screen.render(state)
    await harness.flush()
    screen.render(state)
    await harness.flush()
    return harness.captureCharFrame()
  }

  test('the card shows how long ago, and the open tweet shows the date too', async () => {
    const frame = await frameOf(tweet(ago(3 * hour)))
    expect(frame).toContain('3h')
    expect(frame).toContain('9000 views')
    expect(frame).toContain('Aug 7, 2026')
  })

  test('a long name gives ground before the stamp does', async () => {
    const frame = await frameOf(tweet(ago(5 * day), 'A'.repeat(120)))
    // The detail pane carries the same name, so only the card line has to hold the stamp.
    const lines = frame.split('\n').filter((line) => line.includes('AAAA'))
    expect(lines.some((line) => line.includes('5d'))).toBe(true)
  })

  test('a huge view count gives ground before the date does', async () => {
    const busy = { ...tweet(at(2026, 3, 9, 13, 5)), metrics: { replies: 193000, reposts: 65000, likes: 1984000, views: 181110000 } }
    const frame = await frameOf(busy)
    const counts = frame.split('\n').find((line) => line.includes('comments')) ?? ''
    expect(counts).toContain('1:05 PM · Mar 9, 2026')
  })
})
