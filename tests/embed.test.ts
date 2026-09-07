import { describe, expect, test } from 'bun:test'
import { BoxRenderable } from '@opentui/core'
import { createTestRenderer } from '@opentui/core/testing'

import { avatarSlot, cardAuthorLine, cardMetrics, tweetCard, toPlacement } from '../src/embed/tweetCard.ts'
import type { AppTweet } from '../src/twitter/types.ts'

const tweet = (over: Partial<AppTweet> = {}): AppTweet => ({
  id: '1870000000000000101',
  text: 'most devtools are rented, not owned',
  author: { handle: 'synth_dev', name: 'Synth Dev', avatarUrl: 'https://pbs.test/a.jpg', verified: true },
  createdAt: '2026-09-01T10:00:00.000Z',
  media: [],
  metrics: { replies: 2, reposts: 3, likes: 4 },
  ...over
})

describe('the card another app embeds', () => {
  test('carries the name, the handle, the text and the metrics', async () => {
    const { renderer, flush, captureCharFrame } = await createTestRenderer({ width: 80, height: 12 })
    const pane = new BoxRenderable(renderer, { id: 'pane', width: '100%', height: '100%', flexDirection: 'column' })
    renderer.root.add(pane)

    const built = tweetCard(renderer, { id: 'card', tweet: tweet(), now: new Date('2026-09-02T10:00:00.000Z') })
    pane.add(built.card)
    await flush()

    const frame = captureCharFrame()
    expect(frame).toContain('Synth Dev')
    expect(frame).toContain('@synth_dev')
    expect(frame).toContain('most devtools are rented')
    expect(frame).toContain('4 likes')
    // The stamp is the same relative clock the timeline uses.
    expect(frame).toContain('1d')
  })

  test('says how it wants the avatar drawn, and says nothing without one', () => {
    const pane = { x: 0, y: 0, width: 40, height: 10 } as unknown as BoxRenderable
    const built = { card: pane, avatar: { x: 1, y: 1, width: 7, height: 3 } as unknown as BoxRenderable }
    const slot = avatarSlot('card', tweet(), built, pane)
    expect(slot?.url).toBe('https://pbs.test/a.jpg')
    expect(avatarSlot('card', tweet({ author: { handle: 'h', name: 'n' } }), built, pane)).toBeUndefined()
  })

  test('a slot that spills out of its pane is dropped rather than painted over a neighbour', () => {
    const renderer = { terminalWidth: 40, terminalHeight: 10 } as unknown as Parameters<typeof toPlacement>[3]
    const pane = { x: 0, y: 0, width: 20, height: 10 } as unknown as BoxRenderable
    const cell = { widthPx: 10, heightPx: 20 }
    const inside = { key: 'a', url: 'u', box: { x: 1, y: 1, width: 7, height: 3 } as unknown as BoxRenderable, pane, minCols: 7, minRows: 3 }
    const outside = { ...inside, box: { x: 18, y: 1, width: 7, height: 3 } as unknown as BoxRenderable }

    expect(toPlacement(inside, 'circle', cell, renderer)).toMatchObject({ col: 2, row: 2, cols: 7, rows: 3 })
    expect(toPlacement(outside, 'circle', cell, renderer)).toBeUndefined()
  })

  test('the author line and the metrics line read the way the timeline writes them', () => {
    expect(cardAuthorLine(tweet(), '  quote')).toBe('Synth Dev ✔  @synth_dev  quote')
    expect(cardMetrics(tweet())).toContain('2 replies')
  })
})
