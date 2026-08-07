import { describe, expect, test } from 'bun:test'
import { createTestRenderer } from '@opentui/core/testing'
import { createMainScreen, type MainScreen } from '../src/app/mainScreen.ts'
import type { ImagePlacement } from '../src/media/imageLayer.ts'
import { initialAppState, mergeTimelinePage, toggleLightbox, type AppState } from '../src/state/store.ts'
import type { AppMedia, AppTweet } from '../src/twitter/types.ts'

const photo: AppMedia = { type: 'photo', url: 'https://pbs.twimg.test/media/one.jpg', width: 1200, height: 800 }
const quotePhoto: AppMedia = { type: 'photo', url: 'https://pbs.twimg.test/media/two.jpg', width: 900, height: 900 }

const tweet = (id: string, media: AppMedia[], quoted?: AppTweet): AppTweet => ({
  id,
  text: `tweet ${id}`,
  author: { handle: `u${id}`, name: `U${id}` },
  media,
  metrics: {},
  quotedTweet: quoted
})

const setup = async (): Promise<{
  screen: MainScreen
  clicks: string[]
  closes: number
  mouse: Awaited<ReturnType<typeof createTestRenderer>>['mockMouse']
  flush: () => Promise<void>
  state: AppState
}> => {
  // Tall enough that the detail pane can pay for the tweet photo and the quoted one.
  const harness = await createTestRenderer({ width: 174, height: 52 })
  const clicks: string[] = []
  const counter = { closes: 0 }
  const screen = createMainScreen(harness.renderer, {
    onOpenPhoto: (source) => { clicks.push(source) },
    onCloseLightbox: () => { counter.closes += 1 }
  })
  const quoted = tweet('q1', [quotePhoto])
  const state = mergeTimelinePage(initialAppState(), 'following', [tweet('1', [photo], quoted)], {})
  // The first pass has no measured pane, so the row budget only lands on the second.
  screen.render(state)
  await harness.flush()
  screen.render(state)
  await harness.flush()
  return {
    screen,
    clicks,
    get closes() { return counter.closes },
    mouse: harness.mockMouse,
    flush: harness.flush,
    state
  }
}

// The image boxes carry no text, so a placement is the only proof they were laid out.
const rect = (screen: MainScreen, key: string): ImagePlacement => {
  const placement = screen.placements().find((item) => item.key === key)
  if (!placement) {
    throw new Error(`no placement for ${key}`)
  }
  return placement
}

describe('lightbox', () => {
  test('a click on the detail photo asks to open it', async () => {
    const harness = await setup()
    const box = rect(harness.screen, 'media:1:0')
    await harness.mouse.click(box.col, box.row)
    await harness.flush()
    expect(harness.clicks).toEqual(['tweet'])
  })

  test('a click on the quoted photo names the quote', async () => {
    const harness = await setup()
    const box = rect(harness.screen, 'media:q1:0')
    await harness.mouse.click(box.col, box.row)
    await harness.flush()
    expect(harness.clicks).toEqual(['quote'])
  })

  test('the open photo is far larger than the one in the detail pane', async () => {
    const harness = await setup()
    const inPane = rect(harness.screen, 'media:1:0')
    harness.screen.render(toggleLightbox(harness.state, harness.state.tweets['1'], photo))
    await harness.flush()
    const enlarged = rect(harness.screen, 'lightbox:1')
    expect(enlarged.cols * enlarged.rows).toBeGreaterThan(inPane.cols * inPane.rows * 4)
  })

  test('the open photo hides every other image', async () => {
    const harness = await setup()
    harness.screen.render(toggleLightbox(harness.state, harness.state.tweets['1'], photo))
    await harness.flush()
    expect(harness.screen.placements().map((item) => item.key)).toEqual(['lightbox:1'])
  })

  test('a click on the open photo asks to close it', async () => {
    const harness = await setup()
    harness.screen.render(toggleLightbox(harness.state, harness.state.tweets['1'], photo))
    await harness.flush()
    const box = rect(harness.screen, 'lightbox:1')
    await harness.mouse.click(box.col, box.row)
    await harness.flush()
    expect(harness.closes).toBe(1)
  })
})
