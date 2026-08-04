import { describe, expect, test } from 'bun:test'
import { createTestRenderer } from '@opentui/core/testing'
import { createMainScreen, detailHint, type MainScreen } from '../src/app/mainScreen.ts'
import type { ImagePlacement } from '../src/media/imageLayer.ts'
import {
  enterSelection,
  focusedTweet,
  initialAppState,
  leaveSelection,
  mergeTimelinePage,
  selectRelativeTweet,
  toggleLightbox,
  type AppState
} from '../src/state/store.ts'
import type { AppMedia, AppTweet } from '../src/twitter/types.ts'

const photo: AppMedia = { type: 'photo', url: 'https://pbs.twimg.test/media/one.jpg', width: 1200, height: 800 }
const quotePhoto: AppMedia = { type: 'photo', url: 'https://pbs.twimg.test/media/two.jpg', width: 900, height: 900 }
const avatar = 'https://pbs.twimg.test/profile/one.jpg'

const tweet = (id: string, media: AppMedia[] = [], quoted?: AppTweet): AppTweet => ({
  id,
  text: `tweet ${id}`,
  author: { handle: `u${id}`, name: `U${id}`, avatarUrl: avatar },
  media,
  metrics: {},
  quotedTweet: quoted
})

const feedWithQuote = (quoted: AppTweet): AppState =>
  mergeTimelinePage(initialAppState(), 'following', [tweet('1', [photo], quoted), tweet('2')], {})

describe('quote navigation', () => {
  test('entering a quote focuses it without moving the timeline cursor', () => {
    const state = enterSelection(feedWithQuote(tweet('q1', [quotePhoto])))
    expect(state.detailStack).toEqual(['q1'])
    expect(state.selectedTweetId).toBe('1')
    expect(focusedTweet(state)?.id).toBe('q1')
  })

  test('a tweet without a quote does not move', () => {
    const state = mergeTimelinePage(initialAppState(), 'following', [tweet('1')], {})
    expect(enterSelection(state)).toBe(state)
  })

  test('a quote inside a quote pushes twice and comes back one step at a time', () => {
    const inner = tweet('q2')
    let state = enterSelection(feedWithQuote(tweet('q1', [], inner)))
    state = enterSelection(state)
    expect(state.detailStack).toEqual(['q1', 'q2'])
    expect(focusedTweet(state)?.id).toBe('q2')
    state = leaveSelection(state)
    expect(focusedTweet(state)?.id).toBe('q1')
    state = leaveSelection(state)
    expect(focusedTweet(state)?.id).toBe('1')
  })

  test('going back from the timeline tweet does nothing', () => {
    const state = feedWithQuote(tweet('q1'))
    expect(leaveSelection(state)).toBe(state)
  })

  test('moving the timeline cursor leaves the quote and says so', () => {
    const state = enterSelection(feedWithQuote(tweet('q1')))
    const moved = selectRelativeTweet(state, 1)
    expect(moved.detailStack).toEqual([])
    expect(moved.status).toBe('left quote')
  })

  test('moving the timeline cursor keeps the status when no quote is open', () => {
    const state = { ...feedWithQuote(tweet('q1')), status: 'loaded 2 tweets' }
    expect(selectRelativeTweet(state, 1).status).toBe('loaded 2 tweets')
  })

  test('an open photo closes on the way in and on the way back', () => {
    let state = feedWithQuote(tweet('q1'))
    state = toggleLightbox(state, tweet('1', [photo]), photo)
    state = enterSelection(state)
    expect(state.lightbox).toBeUndefined()
    state = toggleLightbox(state, tweet('q1', [quotePhoto]), quotePhoto)
    expect(leaveSelection(state).lightbox).toBeUndefined()
  })

  test('the hint line states how to go in and how to come back', () => {
    expect(detailHint(tweet('1', [], tweet('q1')), 0)).toBe('Shift+→ or click the quote')
    expect(detailHint(tweet('q1'), 1)).toBe('depth 1  ·  Shift+← back')
    expect(detailHint(tweet('q1', [], tweet('q2')), 1)).toBe('depth 1  ·  Shift+← back  ·  Shift+→ or click the quote')
    expect(detailHint(tweet('1'), 0)).toBe('')
    expect(detailHint(undefined, 0)).toBe('Select a tweet with j/k.')
  })
})

const setup = async (): Promise<{
  screen: MainScreen
  quotes: number
  photos: string[]
  mouse: Awaited<ReturnType<typeof createTestRenderer>>['mockMouse']
  state: AppState
  draw: (next: AppState) => Promise<void>
}> => {
  // Tall enough that the detail pane can pay for the tweet photo and the quoted one.
  const harness = await createTestRenderer({ width: 174, height: 52 })
  const counter = { quotes: 0 }
  const photos: string[] = []
  const screen = createMainScreen(harness.renderer, {
    onOpenQuote: () => { counter.quotes += 1 },
    onOpenPhoto: (source) => { photos.push(source) }
  })
  const state = feedWithQuote(tweet('q1', [quotePhoto]))
  const draw = async (next: AppState): Promise<void> => {
    screen.render(next)
    await harness.flush()
  }
  // The first pass has no measured pane, so the row budget only lands on the second.
  await draw(state)
  await draw(state)
  return { screen, get quotes() { return counter.quotes }, photos, mouse: harness.mockMouse, state, draw }
}

// The quote card carries no unique text, so a placement inside it is the only handle
// the test has on its screen position.
const rect = (screen: MainScreen, key: string): ImagePlacement => {
  const placement = screen.placements().find((item) => item.key === key)
  if (!placement) {
    throw new Error(`no placement for ${key}`)
  }
  return placement
}

describe('quote card clicks', () => {
  test('a click on the quote card opens the quote', async () => {
    const harness = await setup()
    const box = rect(harness.screen, 'avatar:q1')
    await harness.mouse.click(box.col, box.row)
    expect(harness.quotes).toBe(1)
    expect(harness.photos).toEqual([])
  })

  test('a click on the quoted photo enlarges it instead of opening the quote', async () => {
    const harness = await setup()
    const box = rect(harness.screen, 'media:q1')
    await harness.mouse.click(box.col, box.row)
    expect(harness.photos).toEqual(['quote'])
    expect(harness.quotes).toBe(0)
  })

  test('the detail pane switches to the quote once it is open', async () => {
    const harness = await setup()
    await harness.draw(enterSelection(harness.state))
    const keys = harness.screen.placements().map((item) => item.key)
    expect(keys).toContain('media:q1')
    expect(keys).not.toContain('media:1')
  })
})
