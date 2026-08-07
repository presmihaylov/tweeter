import { describe, expect, test } from 'bun:test'
import { createTestRenderer } from '@opentui/core/testing'
import { articlePill, createMainScreen, detailBlock, detailHint, detailLayout } from '../src/app/mainScreen.ts'
import {
  clearDetailSelection,
  focusDetailText,
  initialAppState,
  mergeConversationPage,
  mergeFocalTweet,
  mergeTimelinePage,
  selectFirstReply,
  selectRelativeDetail,
  selectRelativeTweet,
  type AppState
} from '../src/state/store.ts'
import { TwitterClient } from '../src/twitter/client.ts'
import { mapTweetResult } from '../src/twitter/extract/tweet.ts'
import { jsonResponse, makeTweetResult, tweetDetailBody } from './helpers.ts'
import type { AppTweet } from '../src/twitter/types.ts'

const title = 'A synthetic headline'
const body = Array.from({ length: 60 }, (_, index) => `body line ${index}`).join('\n')

const articleResult = (id: string): unknown => ({
  ...(makeTweetResult(id, 'writer', title) as Record<string, unknown>),
  article: { article_results: { result: { title, plain_text: body } } }
})

const appTweet = (id: string, article = false): AppTweet => ({
  id,
  text: article ? `${title}\n\n${body}` : 'a short tweet',
  author: { handle: `u${id}`, name: `U${id}` },
  media: [],
  metrics: { replies: 1, reposts: 2, likes: 3 },
  article: article ? { title } : undefined
})

describe('an article behind a tweet', () => {
  test('carries its title beside the whole body', () => {
    const tweet = mapTweetResult(articleResult('1'))
    expect(tweet?.article).toEqual({ title })
    expect(tweet?.text.startsWith(`${title}\n\n`)).toBe(true)
    expect(tweet?.text).toContain('body line 59')
  })

  test('a plain tweet is not marked as one', () => {
    expect(mapTweetResult(makeTweetResult('2', 'alice', 'hello'))?.article).toBeUndefined()
  })

  test('a repost keeps the mark of the article it carries', () => {
    const repost = { ...(makeTweetResult('3', 'bob', 'RT') as Record<string, unknown>) }
    repost.legacy = { ...(repost.legacy as Record<string, unknown>), retweeted_status_result: { result: articleResult('1') } }
    expect(mapTweetResult(repost)?.article).toEqual({ title })
  })

  test('the badge names it on any card that draws it', () => {
    expect(articlePill(appTweet('1', true))).toBe('▤ article · ')
    expect(articlePill(appTweet('1'))).toBe('')
    expect(articlePill(undefined)).toBe('')
  })
})

// The feed carries an article as its title alone; X only sends the body with the detail.
const feedCopy = (id: string): AppTweet => ({ ...appTweet(id, true), text: title })

describe('the body the feed leaves out', () => {
  // Every read also fetches the x.com shell to sign itself; only the query is scripted.
  const clientFor = (body: unknown): TwitterClient => new TwitterClient({
    authToken: 'auth',
    ct0: 'csrf',
    graphQLBase: 'https://x.com/i/api/graphql',
    fetch: async (input) => {
      const path = new URL(input.toString()).pathname
      return path.includes('/graphql/') ? jsonResponse(body) : jsonResponse({}, { status: 404 })
    }
  })

  test('the reply page hands back the tweet the reader opened', async () => {
    const client = clientFor(tweetDetailBody(articleResult('1'), [makeTweetResult('2', 'alice', 'nice piece')]))
    const page = await client.loadRepliesPage({ tweetId: '1' })
    expect(page.replies.map((reply) => reply.id)).toEqual(['2'])
    expect(page.focal?.id).toBe('1')
    expect(page.focal?.text).toContain('body line 59')
  })

  test('the fuller copy replaces the one the feed sent', () => {
    const state = mergeTimelinePage(initialAppState(), 'following', [feedCopy('1')], {})
    expect(state.tweets['1']?.text).toBe(title)
    expect(mergeFocalTweet(state, appTweet('1', true)).tweets['1']?.text).toContain('body line 59')
  })

  test('it keeps the repost mark, which only the feed knows', () => {
    const state = mergeTimelinePage(initialAppState(), 'following', [{ ...feedCopy('1'), repostedBy: { handle: 'u2', name: 'U2' } }], {})
    expect(mergeFocalTweet(state, appTweet('1', true)).tweets['1']?.repostedBy).toEqual({ handle: 'u2', name: 'U2' })
  })

  test('a copy that carries no more text keeps the body already read', () => {
    const state = mergeTimelinePage(initialAppState(), 'following', [appTweet('1', true)], {})
    expect(mergeFocalTweet(state, feedCopy('1')).tweets['1']?.text).toContain('body line 59')
  })
})

describe('the rows an article claims', () => {
  const opts = { photo: false, quote: false, quotePhoto: false, parent: false, textLines: 200 }

  test('takes every row the pane can spare above one reply card', () => {
    const layout = detailLayout(50, { ...opts, article: true })
    expect(layout.text).toBe(29)
    expect(layout.replies).toBe(6)
  })

  test('a long tweet that is not an article keeps the old cap', () => {
    expect(detailLayout(50, opts).text).toBe(12)
  })

  test('leaves the cover photo its rows', () => {
    const layout = detailLayout(50, { ...opts, photo: true, article: true })
    expect(layout.text).toBe(25)
    expect(layout.media).toBeGreaterThanOrEqual(3)
    expect(layout.replies).toBe(6)
  })

  test('a pane too small to pay for both never drops below the old cap', () => {
    expect(detailLayout(28, { ...opts, article: true }).text).toBeGreaterThanOrEqual(12)
  })
})

describe('the text as a stop for the arrows', () => {
  const withArticle = (): AppState =>
    mergeConversationPage(
      mergeTimelinePage(initialAppState(), 'following', [appTweet('1', true), appTweet('2')], {}),
      '1',
      [{ ...appTweet('r0'), inReplyToStatusId: '1' }]
    )

  test('→ hands the arrows to the article before the replies', () => {
    const state = focusDetailText(withArticle())
    expect(state.textFocused).toBe(true)
    expect(state.selectedDetailId).toBeUndefined()
    expect(state.status).toBe('reading the article · ↑/↓ scroll · → replies')
  })

  test('a tweet that is not an article says text instead', () => {
    const state = focusDetailText(mergeTimelinePage(initialAppState(), 'following', [appTweet('2')], {}))
    expect(state.status).toBe('reading the text · ↑/↓ scroll · → replies')
  })

  test('an empty feed has no text to read', () => {
    const state = initialAppState()
    expect(focusDetailText(state)).toBe(state)
  })

  test('the next → moves on to the replies', () => {
    const state = selectFirstReply(focusDetailText(withArticle()))
    expect(state.textFocused).toBe(false)
    expect(state.selectedDetailId).toBe('r0')
  })

  test('Shift+↓ takes the arrows off the text as well', () => {
    expect(selectRelativeDetail(focusDetailText(withArticle()), 1).textFocused).toBe(false)
  })

  test('← hands them back to the feed', () => {
    const state = clearDetailSelection(focusDetailText(withArticle()))
    expect(state.textFocused).toBe(false)
    expect(state.status).toBe('back to the feed')
  })

  test('j leaves the article without a key of its own', () => {
    const state = selectRelativeTweet(focusDetailText(withArticle()), 1)
    expect(state.textFocused).toBe(false)
    expect(state.selectedTweetId).toBe('2')
  })
})

describe('the scroll markers', () => {
  const lines = Array.from({ length: 40 }, (_, index) => `L${index}`)

  test('name the arrows once the arrows own the text', () => {
    const block = detailBlock(lines, 10, 6, true)
    expect(block.above).toBe('▴ 10 more above · ↑')
    expect(block.below).toBe('▾ 26 more below · ↓')
  })

  test('name Ctrl while the feed owns them', () => {
    expect(detailBlock(lines, 10, 6).above).toBe('▴ 10 more above · Ctrl+W')
  })

  test('the hint line says which key reaches the rest', () => {
    const article = appTweet('1', true)
    expect(detailHint(article, 0, false, { scrolls: true, focused: false })).toBe('→ reads the article')
    expect(detailHint(article, 0, false, { scrolls: true, focused: true })).toBe('↑/↓ scroll  ·  → replies')
    expect(detailHint(appTweet('2'), 0, false, { scrolls: false, focused: false })).toBe('')
  })
})

describe('an article on the screen', () => {
  const render = async (state: AppState): Promise<{ frame: string; scrolls: boolean }> => {
    const harness = await createTestRenderer({ width: 174, height: 52 })
    const screen = createMainScreen(harness.renderer, {})
    // The first pass has no measured pane, so the row budget only lands on the second.
    screen.render(state)
    await harness.flush()
    screen.render(state)
    await harness.flush()
    return { frame: harness.captureCharFrame(), scrolls: screen.detailScrolls() }
  }

  const state = (article: boolean): AppState =>
    mergeTimelinePage(initialAppState(), 'following', [appTweet('1', article)], {})

  test('the badge sits on the card and on the open tweet', async () => {
    const drawn = await render(state(true))
    expect(drawn.frame.split('\n').filter((row) => row.includes('▤ article')).length).toBe(2)
  })

  test('a plain tweet carries no badge', async () => {
    expect((await render(state(false))).frame).not.toContain('▤ article')
  })

  test('the pane shows far more of the body than the old cap allowed', async () => {
    const drawn = await render(state(true))
    // Only the detail pane gives a body line a row of its own; the card runs them together.
    const rows = drawn.frame.split('\n').filter((row) => /│\s+body line \d+\s+│/.test(row))
    expect(rows.length).toBeGreaterThan(12)
    expect(drawn.frame).toContain('body line 15')
    expect(drawn.scrolls).toBe(true)
  })

  test('a short tweet is not a stop for the arrows', async () => {
    expect((await render(state(false))).scrolls).toBe(false)
  })

  test('the markers follow the arrows onto the text', async () => {
    const drawn = await render(focusDetailText(state(true)))
    expect(drawn.frame).toContain('↑/↓ scroll  ·  → replies')
    expect(drawn.frame).toMatch(/▾ \d+ more below · ↓/)
  })
})
