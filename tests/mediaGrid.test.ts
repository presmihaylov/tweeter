import { describe, expect, test } from 'bun:test'
import { createTestRenderer } from '@opentui/core/testing'
import { createMainScreen, type MainScreen } from '../src/app/mainScreen.ts'
import type { ImagePlacement } from '../src/media/imageLayer.ts'
import { initialAppState, mergeTimelinePage, previewsOf, type AppState } from '../src/state/store.ts'
import type { AppMedia, AppTweet } from '../src/twitter/types.ts'

const photo = (index: number): AppMedia => ({ type: 'photo', url: `https://pbs.twimg.test/media/${index}.jpg`, width: 1600, height: 900 })

const photos = (count: number): AppMedia[] => Array.from({ length: count }, (_, index) => photo(index))

const tweet = (id: string, media: AppMedia[], quoted?: AppTweet): AppTweet => ({
  id,
  text: `tweet ${id}`,
  author: { handle: `u${id}`, name: `U${id}` },
  media,
  metrics: {},
  quotedTweet: quoted
})

const setup = async (media: AppMedia[], quoted?: AppTweet): Promise<{
  screen: MainScreen
  clicks: Array<{ source: string; index?: number }>
  mouse: Awaited<ReturnType<typeof createTestRenderer>>['mockMouse']
  flush: () => Promise<void>
  state: AppState
}> => {
  const harness = await createTestRenderer({ width: 174, height: 52 })
  const clicks: Array<{ source: string; index?: number }> = []
  const screen = createMainScreen(harness.renderer, {
    onOpenPhoto: (source, index) => { clicks.push({ source, index }) }
  })
  const state = mergeTimelinePage(initialAppState(), 'following', [tweet('1', media, quoted)], {})
  // The first pass has no measured pane, so the row budget only lands on the second.
  screen.render(state)
  await harness.flush()
  screen.render(state)
  await harness.flush()
  return { screen, clicks, mouse: harness.mockMouse, flush: harness.flush, state }
}

const tiles = (screen: MainScreen, prefix: string): ImagePlacement[] =>
  screen.placements().filter((item) => item.key.startsWith(prefix)).sort((left, right) => left.col - right.col)

describe('a tweet that carries four pictures', () => {
  test('draws one tile for every picture', async () => {
    const harness = await setup(photos(4))
    expect(tiles(harness.screen, 'media:1:').map((item) => item.key)).toEqual(['media:1:0', 'media:1:1', 'media:1:2', 'media:1:3'])
  })

  test('puts the tiles beside each other on the same row', async () => {
    const harness = await setup(photos(4))
    const drawn = tiles(harness.screen, 'media:1:')
    expect(new Set(drawn.map((item) => item.row)).size).toBe(1)
    for (let index = 1; index < drawn.length; index += 1) {
      const before = drawn[index - 1]
      const here = drawn[index]
      expect(here?.col ?? 0).toBeGreaterThanOrEqual((before?.col ?? 0) + (before?.cols ?? 0))
    }
  })

  test('every tile carries its own picture', async () => {
    const harness = await setup(photos(4))
    expect(tiles(harness.screen, 'media:1:').map((item) => item.url)).toEqual(photos(4).map((item) => item.url))
  })

  test('a click names the tile it landed on', async () => {
    const harness = await setup(photos(4))
    const third = tiles(harness.screen, 'media:1:')[2]
    await harness.mouse.click(third?.col ?? 0, third?.row ?? 0)
    await harness.flush()
    expect(harness.clicks).toEqual([{ source: 'tweet', index: 2 }])
  })

  test('a single picture still fills the row on its own', async () => {
    const harness = await setup(photos(1))
    const drawn = tiles(harness.screen, 'media:1:')
    expect(drawn).toHaveLength(1)
    expect(drawn[0]?.cols ?? 0).toBeGreaterThan(20)
  })

  test('the quoted tweet draws all of its pictures too', async () => {
    const harness = await setup(photos(1), tweet('q1', photos(4)))
    expect(tiles(harness.screen, 'media:q1:')).toHaveLength(4)
  })
})

describe('the pictures a tweet offers', () => {
  test('stops at the four X allows', () => {
    expect(previewsOf(tweet('1', photos(6)))).toHaveLength(4)
  })

  test('is empty for a tweet with no picture and for no tweet at all', () => {
    expect(previewsOf(tweet('1', []))).toEqual([])
    expect(previewsOf(undefined)).toEqual([])
  })
})
