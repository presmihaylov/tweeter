import { describe, expect, test } from 'bun:test'
import { createTestRenderer } from '@opentui/core/testing'
import { createMainScreen, toastTop, toastWidth } from '../src/app/mainScreen.ts'
import { clearToast, initialAppState, mergeTimelinePage, showToast, type AppState } from '../src/state/store.ts'
import { tweetUrl } from '../src/media/openExternal.ts'
import type { AppTweet } from '../src/twitter/types.ts'

const tweet: AppTweet = {
  id: '1750000000000000000',
  text: 'a short tweet',
  author: { handle: 'writer', name: 'Writer' },
  media: [],
  metrics: { replies: 1, reposts: 2, likes: 3 }
}

const feed = (): AppState => mergeTimelinePage(initialAppState(), 'following', [tweet], {})

describe('the link a reader copies', () => {
  test('points at the tweet on x.com', () => {
    expect(tweetUrl(tweet)).toBe('https://x.com/writer/status/1750000000000000000')
  })

  test('a quoted card carries the link of its own author', () => {
    const quoted: AppTweet = { ...tweet, id: '2', author: { handle: 'other', name: 'Other' } }
    expect(tweetUrl(quoted)).toBe('https://x.com/other/status/2')
  })
})

describe('the corner note', () => {
  test('a copy raises it and the clock takes it away', () => {
    const raised = showToast(feed(), '⧉ link copied')
    expect(raised.toast).toBe('⧉ link copied')
    expect(clearToast(raised).toast).toBeUndefined()
  })

  test('a state with no note is left alone', () => {
    const state = feed()
    expect(clearToast(state)).toBe(state)
  })

  test('a second copy replaces the first note', () => {
    expect(showToast(showToast(feed(), 'first'), 'second').toast).toBe('second')
  })

  test('it takes its own width, and never more than the window holds', () => {
    expect(toastWidth('⧉ link copied', 120)).toBe(17)
    expect(toastWidth('x', 120)).toBe(10)
    expect(toastWidth('a note far longer than this window', 24)).toBe(18)
  })
})

describe('the note on the screen', () => {
  const render = async (state: AppState, width = 120): Promise<string> => {
    const harness = await createTestRenderer({ width, height: 30 })
    const screen = createMainScreen(harness.renderer, {})
    // The first pass has no measured pane, so the row budget only lands on the second.
    screen.render(state)
    await harness.flush()
    screen.render(state)
    await harness.flush()
    return harness.captureCharFrame()
  }

  test('sits in the top right corner, under the header', async () => {
    const rows = (await render(showToast(feed(), '⧉ link copied'))).split('\n')
    const row = rows.findIndex((line) => line.includes('⧉ link copied'))
    expect(row).toBe(toastTop + 1)
    const line = rows[row] ?? ''
    // Nothing of the note sits on the left half of the window.
    expect(line.indexOf('⧉')).toBeGreaterThan(60)
    expect(line.trimEnd().endsWith('│')).toBe(true)
  })

  test('a tweet with no copy behind it shows no note', async () => {
    expect(await render(feed())).not.toContain('⧉')
  })

  test('a failed copy says so in the same corner', async () => {
    expect(await render(showToast(feed(), '⧉ copy failed'))).toContain('⧉ copy failed')
  })

  test('a narrow window cuts the note rather than lose the border', async () => {
    const rows = (await render(showToast(feed(), '⧉ a note far longer than this window'), 60)).split('\n')
    const row = rows.find((line) => line.includes('⧉ a note'))
    expect(row).toBeDefined()
    expect((row ?? '').length).toBeLessThanOrEqual(60)
  })
})
