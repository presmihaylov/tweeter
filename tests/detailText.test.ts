import { describe, expect, test } from 'bun:test'
import { createTestRenderer } from '@opentui/core/testing'
import { clampScroll, createMainScreen, decodeEntities, detailBlock, metricsLine, repostPill, wrapText } from '../src/app/mainScreen.ts'
import { initialAppState, mergeTimelinePage } from '../src/state/store.ts'
import type { AppTweet } from '../src/twitter/types.ts'

describe('decodeEntities', () => {
  test('decodes the entities X leaves escaped', () => {
    expect(decodeEntities('a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;')).toBe('a & b <c> "d" \'e\'')
  })

  test('decodes numeric entities', () => {
    expect(decodeEntities('&#8212; &#65;')).toBe('— A')
  })

  test('leaves an unknown entity alone', () => {
    expect(decodeEntities('&copy; &#0;')).toBe('&copy; &#0;')
  })
})

describe('wrapText', () => {
  test('wraps on word boundaries', () => {
    expect(wrapText('the quick brown fox', 10)).toEqual(['the quick', 'brown fox'])
  })

  test('keeps the blank lines the author typed', () => {
    expect(wrapText('one\n\ntwo', 10)).toEqual(['one', '', 'two'])
  })

  test('cuts a word that is wider than the pane', () => {
    expect(wrapText('ab https://example.test/very/long', 8)).toEqual(['ab', 'https://', 'example.', 'test/ver', 'y/long'])
  })

  test('returns the raw lines when the width is unknown', () => {
    expect(wrapText('one two\nthree', 0)).toEqual(['one two', 'three'])
  })
})

describe('clampScroll', () => {
  test('stops at the page that shows the last line', () => {
    expect(clampScroll(50, 20, 6)).toBe(15)
  })

  test('never scrolls above the first line', () => {
    expect(clampScroll(-4, 20, 6)).toBe(0)
  })

  test('stays at zero when everything fits', () => {
    expect(clampScroll(3, 5, 6)).toBe(0)
  })
})

const lines = (count: number): string[] => Array.from({ length: count }, (_, index) => `L${index}`)

describe('detailBlock', () => {
  test('marks nothing when the whole tweet fits', () => {
    expect(detailBlock(lines(4), 0, 6)).toEqual({ lines: ['L0', 'L1', 'L2', 'L3'] })
  })

  test('marks the hidden tail on the first page', () => {
    const block = detailBlock(lines(40), 0, 6)
    expect(block.above).toBeUndefined()
    expect(block.lines).toEqual(['L0', 'L1', 'L2', 'L3', 'L4'])
    expect(block.below).toBe('▾ 35 more below · Ctrl+S')
  })

  test('marks both edges in the middle of a tweet', () => {
    const block = detailBlock(lines(40), 10, 6)
    expect(block.above).toBe('▴ 10 more above · Ctrl+W')
    expect(block.lines).toEqual(['L10', 'L11', 'L12', 'L13'])
    expect(block.below).toBe('▾ 26 more below · Ctrl+S')
  })

  test('drops the tail marker on the last page', () => {
    const block = detailBlock(lines(40), clampScroll(99, 40, 6), 6)
    expect(block.above).toBe('▴ 35 more above · Ctrl+W')
    expect(block.lines).toEqual(['L35', 'L36', 'L37', 'L38', 'L39'])
    expect(block.below).toBeUndefined()
  })

  test('every line of the tweet is reachable', () => {
    const seen = new Set<string>()
    for (let top = 0; top <= clampScroll(99, 40, 6); top += 1) {
      for (const line of detailBlock(lines(40), top, 6).lines) {
        seen.add(line)
      }
    }
    expect(seen.size).toBe(40)
  })

  test('returns nothing before the pane is laid out', () => {
    expect(detailBlock(lines(40), 0, 0)).toEqual({ lines: [] })
  })
})

describe('metricsLine', () => {
  const base: AppTweet = {
    id: '1',
    text: 'hello',
    author: { handle: 'u1', name: 'U1' },
    media: [],
    metrics: { replies: 4, reposts: 12, likes: 300, views: 9000 }
  }

  test('shows every count in the x.com order', () => {
    expect(metricsLine(base)).toBe('4 comments   ·   12 reposts   ·   300 likes   ·   9000 views')
  })

  test('shows zeros and drops views when X did not send them', () => {
    expect(metricsLine({ ...base, metrics: {} })).toBe('0 comments   ·   0 reposts   ·   0 likes')
  })
})

const tweetWith = (text: string): AppTweet => ({
  id: '1',
  text,
  author: { handle: 'u1', name: 'U1' },
  media: [],
  metrics: { replies: 1, reposts: 2, likes: 3 }
})

describe('detail scrolling', () => {
  test('Ctrl+S moves down the tweet and Ctrl+W comes back', async () => {
    const harness = await createTestRenderer({ width: 174, height: 52 })
    const screen = createMainScreen(harness.renderer, {})
    const state = mergeTimelinePage(initialAppState(), 'following', [tweetWith(Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\n'))], {})
    // The first pass has no measured pane, so the row budget only lands on the second.
    screen.render(state)
    await harness.flush()
    screen.render(state)
    await harness.flush()
    // The timeline card also prints the first lines, so the assertions use lines that
    // only the detail pane can reach, plus the markers themselves.
    const first = harness.captureCharFrame()
    expect(first).toContain('▾ 49 more below · Ctrl+S')
    expect(first).not.toContain('▴')

    screen.scrollDetail(3)
    screen.render(state)
    await harness.flush()
    const scrolled = harness.captureCharFrame()
    expect(scrolled).toContain('▴ 3 more above · Ctrl+W')
    expect(scrolled).toContain('▾ 47 more below · Ctrl+S')

    screen.scrollDetail(-3)
    screen.render(state)
    await harness.flush()
    const back = harness.captureCharFrame()
    expect(back).toContain('▾ 49 more below · Ctrl+S')
    expect(back).not.toContain('▴')
  })

  test('a short tweet cannot be scrolled off the pane', async () => {
    const harness = await createTestRenderer({ width: 174, height: 52 })
    const screen = createMainScreen(harness.renderer, {})
    const state = mergeTimelinePage(initialAppState(), 'following', [tweetWith('one line only')], {})
    screen.render(state)
    await harness.flush()
    screen.render(state)
    await harness.flush()
    screen.scrollDetail(30)
    screen.render(state)
    await harness.flush()
    expect(harness.captureCharFrame()).toContain('one line only')
  })

  test('the metrics bar sits on the bottom row of the detail pane', async () => {
    const harness = await createTestRenderer({ width: 174, height: 52 })
    const screen = createMainScreen(harness.renderer, {})
    const state = mergeTimelinePage(initialAppState(), 'following', [tweetWith('hello')], {})
    screen.render(state)
    await harness.flush()
    screen.render(state)
    await harness.flush()
    const rows = harness.captureCharFrame().split('\n')
    const metricsRow = rows.findIndex((row) => row.includes('1 comments'))
    const repliesRow = rows.findIndex((row) => row.includes('Loading replies…'))
    expect(metricsRow).toBeGreaterThan(repliesRow)
  })
})

describe('reposts on the screen', () => {
  const reposted: AppTweet = { ...tweetWith('the original text'), repostedBy: { handle: 'u2', name: 'U2' } }

  test('the card and the detail pane both name the reposter', async () => {
    const harness = await createTestRenderer({ width: 174, height: 52 })
    const screen = createMainScreen(harness.renderer, {})
    const state = mergeTimelinePage(initialAppState(), 'following', [reposted], {})
    screen.render(state)
    await harness.flush()
    screen.render(state)
    await harness.flush()
    const frame = harness.captureCharFrame()
    expect(frame).toContain('↻ U2 · U1')
    expect(frame).toContain('@u1  ·  ↻ U2 reposted')
  })

  test('a plain tweet carries no repost mark', () => {
    expect(repostPill(tweetWith('plain'))).toBe('')
    expect(repostPill(reposted)).toBe('↻ U2 · ')
  })
})
