import { describe, expect, test } from 'bun:test'
import { createTestRenderer } from '@opentui/core/testing'
import { bodyImageCap, clampFlowScroll, createMainScreen, detailFlow, flowBlock, flowRows, imageRows, mediaLine, type FlowItem } from '../src/app/mainScreen.ts'
import { initialAppState, mergeTimelinePage, toggleLightbox, type AppState } from '../src/state/store.ts'
import { mapTweetResult } from '../src/twitter/extract/tweet.ts'
import { makeTweetResult } from './helpers.ts'
import type { AppMedia, AppTweet } from '../src/twitter/types.ts'

const title = 'A synthetic headline'
const cell = { widthPx: 20, heightPx: 44 }

const mediaEntry = (mediaId: string, width: number, height: number): unknown => ({
  media_id: mediaId,
  media_key: `3_${mediaId}`,
  media_info: {
    __typename: 'ApiImage',
    original_img_url: `https://pbs.example.test/media/${mediaId}.jpg`,
    original_img_width: width,
    original_img_height: height
  }
})

// X sends the body as Draft.js: an image is an atomic block that names an entity, which
// names a media id, which the media list resolves.
const illustrated = (id: string): unknown => ({
  ...(makeTweetResult(id, 'writer', title) as Record<string, unknown>),
  article: {
    article_results: {
      result: {
        title,
        plain_text: 'an older copy of the body',
        cover_media: mediaEntry('11', 1600, 900),
        media_entities: [mediaEntry('22', 1200, 800)],
        content_state: {
          blocks: [
            { type: 'unstyled', text: 'the opening paragraph', entityRanges: [] },
            { type: 'header-two', text: 'A heading of its own', entityRanges: [] },
            { type: 'unordered-list-item', text: 'the first point', entityRanges: [] },
            { type: 'atomic', text: ' ', entityRanges: [{ key: 1, length: 1, offset: 0 }] },
            { type: 'unstyled', text: '   ', entityRanges: [] },
            { type: 'unstyled', text: 'the closing paragraph', entityRanges: [] }
          ],
          entityMap: [
            { key: '0', value: { type: 'LINK', data: { url: 'https://example.test/a' } } },
            { key: '1', value: { type: 'MEDIA', data: { caption: 'the studio', mediaItems: [{ mediaId: '22' }] } } }
          ]
        }
      }
    }
  }
})

const image = (url: string, width = 1200, height = 800): AppMedia => ({ type: 'photo', url, width, height })

const withImages = (id: string): AppTweet => ({
  id,
  text: `${title}\n\nfirst\nsecond`,
  author: { handle: `u${id}`, name: `U${id}` },
  media: [],
  metrics: { replies: 1, reposts: 2, likes: 3 },
  article: {
    title,
    blocks: [
      { kind: 'image', media: image('https://pbs.example.test/media/cover.jpg', 1600, 900) },
      { kind: 'text', text: 'first' },
      { kind: 'image', media: image('https://pbs.example.test/media/inline.jpg'), caption: 'the studio' },
      { kind: 'text', text: 'second' }
    ]
  }
})

describe('the images inside an article', () => {
  const blocks = mapTweetResult(illustrated('1'))?.article?.blocks ?? []

  test('the cover opens the body, the way x.com draws it', () => {
    expect(blocks[0]).toEqual({ kind: 'image', media: image('https://pbs.example.test/media/11.jpg', 1600, 900) })
  })

  test('an inline image keeps the place the author gave it', () => {
    expect(blocks.map((block) => block.kind)).toEqual(['image', 'text', 'text', 'text', 'image', 'text'])
    expect(blocks[4]).toEqual({ kind: 'image', media: image('https://pbs.example.test/media/22.jpg'), caption: 'the studio' })
  })

  test('a heading and a bullet keep their kind', () => {
    expect(blocks[2]).toEqual({ kind: 'text', text: 'A heading of its own', style: 'header' })
    expect(blocks[3]).toEqual({ kind: 'text', text: 'the first point', style: 'bullet' })
  })

  test('a block of nothing but spaces never reaches the screen', () => {
    expect(blocks.filter((block) => block.kind === 'text' && block.text.trim() === '')).toEqual([])
  })

  test('the text comes from the blocks, not from the older plain copy', () => {
    const text = mapTweetResult(illustrated('1'))?.text ?? ''
    expect(text).toContain('the opening paragraph')
    expect(text).toContain('• the first point')
    expect(text).not.toContain('an older copy')
  })

  test('an article without blocks still answers with its title', () => {
    const bare = { ...(makeTweetResult('2', 'writer', title) as Record<string, unknown>), article: { article_results: { result: { title, plain_text: 'a body' } } } }
    expect(mapTweetResult(bare)?.article).toEqual({ title })
    expect(mapTweetResult(bare)?.text).toBe(`${title}\n\na body`)
  })
})

describe('the body as a flow of rows and pictures', () => {
  const flow = detailFlow(withImages('1'), 20, cell, 'nothing')

  test('the pictures sit between the paragraphs', () => {
    expect(flow.filter((item) => item.kind === 'image').map((item) => item.key)).toEqual(['article:1:0', 'article:1:1'])
    const first = flow.findIndex((item) => item.kind === 'image')
    expect(flow.slice(0, first).every((item) => item.kind === 'line')).toBe(true)
    expect(flow.some((item) => item.kind === 'line' && item.text === 'the studio')).toBe(true)
  })

  test('a tweet that is not an article is rows alone', () => {
    const plain: AppTweet = { ...withImages('2'), article: undefined }
    expect(detailFlow(plain, 20, cell, 'nothing').every((item) => item.kind === 'line')).toBe(true)
  })

  test('a bullet lines its wrapped rest up under the words', () => {
    const bulleted: AppTweet = { ...withImages('3'), article: { title, blocks: [{ kind: 'text', text: 'one two three four', style: 'bullet' }] } }
    const lines = detailFlow(bulleted, 10, cell, 'nothing').filter((item) => item.kind === 'line').map((item) => item.text)
    expect(lines).toContain('• one two')
    expect(lines).toContain('  three')
  })

  test('an empty feed says so instead of drawing nothing', () => {
    expect(detailFlow(undefined, 40, cell, 'Select a tweet with j/k.')[0]).toEqual({ kind: 'line', text: 'Select a tweet with j/k.' })
  })

  test('a picture claims rows by its shape, up to the cap', () => {
    expect(imageRows(image('u', 3000, 400), 80, cell)).toBe(5)
    expect(imageRows(image('u', 900, 1600), 80, cell)).toBe(10)
    expect(imageRows({ type: 'photo', url: 'u' }, 80, cell)).toBe(3)
  })
})

describe('the window over a flow that holds pictures', () => {
  const items: FlowItem[] = [
    { kind: 'line', text: 'L0' },
    { kind: 'image', key: 'k0', media: image('u'), rows: 6 },
    ...Array.from({ length: 8 }, (_, index) => ({ kind: 'line' as const, text: `L${index + 1}` }))
  ]

  test('a picture costs the rows it draws on', () => {
    expect(flowRows(items)).toBe(15)
  })

  test('the tail marker counts rows, not blocks', () => {
    const block = flowBlock(items, 0, 8)
    expect(block.items).toEqual([items[0], items[1]] as FlowItem[])
    expect(block.below).toBe('▾ 8 more below · Ctrl+S')
  })

  test('a picture that is taller than the pane still draws', () => {
    const tall: FlowItem[] = [{ kind: 'image', key: 'k0', media: image('u'), rows: 9 }, { kind: 'line', text: 'L1' }]
    expect(flowBlock(tall, 0, 4).items.length).toBe(1)
  })

  test('the scroll stops where the last row is on screen', () => {
    expect(clampFlowScroll(items, 99, 8)).toBe(3)
    expect(clampFlowScroll(items, 99, 20)).toBe(0)
  })
})

describe('a picture that fits the body window', () => {
  test('the cap follows the rows the body has', () => {
    expect(bodyImageCap(12)).toBe(6)
    expect(bodyImageCap(40)).toBe(10)
    expect(bodyImageCap(4)).toBe(3)
  })

  test('the full cap leaves the cover no room, so the window drops it', () => {
    const items = detailFlow(withImages('1'), 80, cell, 'nothing')
    expect(flowBlock(items, 0, 12).items.some((item) => item.kind === 'image')).toBe(false)
  })

  test('the cap of the window keeps the cover on the screen', () => {
    const items = detailFlow(withImages('1'), 80, cell, 'nothing', bodyImageCap(12))
    expect(flowBlock(items, 0, 12).items.some((item) => item.kind === 'image')).toBe(true)
  })

  // The reader scrolls a row at a time, so a picture that only fits at the top of the
  // window hides behind a blank foot on every row before it.
  test('a picture still draws when four rows of words come first', () => {
    const rows = 12
    const items: FlowItem[] = [
      ...Array.from({ length: 4 }, (_, index) => ({ kind: 'line' as const, text: `L${index}` })),
      { kind: 'image', key: 'k0', media: image('u'), rows: bodyImageCap(rows) },
      ...Array.from({ length: 20 }, (_, index) => ({ kind: 'line' as const, text: `M${index}` }))
    ]
    expect(flowBlock(items, 0, rows).items.some((item) => item.kind === 'image')).toBe(true)
    expect(flowBlock(items, 1, rows).items.some((item) => item.kind === 'image')).toBe(true)
  })
})

describe('the caption row under the body', () => {
  test('names the pictures an article carries and the key that enlarges one', () => {
    const flow = detailFlow(withImages('1'), 40, cell, 'nothing')
    expect(mediaLine(withImages('1'), flow)).toBe('2 images in the article  ·  click one, or p enlarges the one on screen')
  })

  test('a tweet photo still names itself', () => {
    const tweet: AppTweet = { ...withImages('1'), media: [image('https://pbs.example.test/media/p.jpg', 100, 50)] }
    expect(mediaLine(tweet, [])).toBe('photo 100×50')
  })

  test('a tweet with nothing at all says so', () => {
    expect(mediaLine({ ...withImages('1'), article: undefined }, [])).toBe('No media for selected tweet.')
  })
})

describe('an article image in the lightbox', () => {
  const tweet = withImages('1')
  const state = mergeTimelinePage(initialAppState(), 'following', [tweet], {})

  test('each picture opens under its own key', () => {
    const first = toggleLightbox(state, tweet, image('https://a.test/1.jpg'), 'article:1:0')
    const second = toggleLightbox(first, tweet, image('https://a.test/2.jpg'), 'article:1:1')
    expect(second.lightbox?.url).toBe('https://a.test/2.jpg')
  })

  test('the same picture closes again', () => {
    const open = toggleLightbox(state, tweet, image('https://a.test/1.jpg'), 'article:1:0')
    expect(toggleLightbox(open, tweet, image('https://a.test/1.jpg'), 'article:1:0').lightbox).toBeUndefined()
  })
})

describe('the article images on the screen', () => {
  type Drawn = { screen: ReturnType<typeof createMainScreen>; frame: () => string; draw: () => Promise<string> }

  const render = async (state: AppState): Promise<Drawn> => {
    const harness = await createTestRenderer({ width: 174, height: 52 })
    const screen = createMainScreen(harness.renderer, {})
    const draw = async (): Promise<string> => {
      screen.render(state)
      await harness.flush()
      return harness.captureCharFrame()
    }
    // The first pass has no measured pane, so the row budget only lands on the second.
    await draw()
    await draw()
    return { screen, frame: () => harness.captureCharFrame(), draw }
  }

  const articleState = (): AppState => mergeTimelinePage(initialAppState(), 'following', [withImages('1')], {})

  test('the pane asks for a picture of its own for every image it shows', async () => {
    const drawn = await render(articleState())
    const keys = drawn.screen.placements().map((placement) => placement.key).filter((key) => key.startsWith('article:'))
    expect(keys).toContain('article:1:0')
    expect(drawn.screen.visibleArticleImage()?.key).toBe('article:1:0')
  })

  test('a tweet that is not an article asks for none', async () => {
    const plain: AppTweet = { ...withImages('2'), article: undefined }
    const drawn = await render(mergeTimelinePage(initialAppState(), 'following', [plain], {}))
    expect(drawn.screen.placements().filter((placement) => placement.key.startsWith('article:'))).toEqual([])
    expect(drawn.screen.visibleArticleImage()).toBeUndefined()
  })

  test('a picture holds its rows open in the body, above the words that follow it', async () => {
    const drawn = await render(articleState())
    expect(drawn.frame()).toContain('first')
    // The cover claims ten rows before the first paragraph, so the rest is below the fold.
    expect(drawn.frame()).not.toContain('the studio')
  })

  test('the scroll walks past a picture to the words under it', async () => {
    const drawn = await render(articleState())
    drawn.screen.scrollDetail(6)
    const frame = await drawn.draw()
    expect(frame).toContain('the studio')
    expect(frame).toContain('second')
    expect(drawn.screen.visibleArticleImage()?.key).toBe('article:1:1')
  })
})
