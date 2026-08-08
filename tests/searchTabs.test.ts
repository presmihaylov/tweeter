import { describe, expect, test } from 'bun:test'
import { addSearchTab, initialAppState, isSearchTab, mergeTimelinePage, openComposer, removeSearchTab, searchQueryOf, searchTabIdOf, tabOrder, type AppState, type SearchTabId } from '../src/state/store.ts'
import { composerHeading, railLabel, railTabs, tabName, timelineTitle } from '../src/app/mainScreen.ts'
import { nextTab } from '../src/app/terminalApp.ts'
import { TwitterClient } from '../src/twitter/client.ts'
import { jsonResponse, makeTweetResult, textResponse } from './helpers.ts'
import type { AppTweet } from '../src/twitter/types.ts'

const tweet = (id: string): AppTweet => ({
  id,
  text: `tweet ${id}`,
  author: { handle: `u${id}`, name: `U${id}` },
  media: [],
  metrics: {}
})

const claudeCode: SearchTabId = 'search:claude code'

const withTab = (query = 'claude code'): AppState => addSearchTab(initialAppState(), query)

const searchBody = (tweets: unknown[]): unknown => ({
  data: {
    search_by_raw_query: {
      search_timeline: {
        timeline: {
          instructions: [{
            entries: [
              ...tweets.map((result, index) => ({
                entryId: `tweet-${index}`,
                content: { entryType: 'TimelineTimelineItem', itemContent: { tweet_results: { result } } }
              })),
              { entryId: 'cursor-top-0', content: { cursorType: 'Top', value: 'search-top' } },
              { entryId: 'cursor-bottom-0', content: { cursorType: 'Bottom', value: 'search-bottom' } }
            ]
          }]
        }
      }
    }
  }
})

describe('a tab the reader adds', () => {
  test('opens on the query, keyed by the words rather than by the order they were added', () => {
    const state = withTab()
    expect(state.activeTab).toBe(claudeCode)
    expect(state.searchTabs).toEqual([{ id: claudeCode, query: 'claude code' }])
    expect(state.timelines[claudeCode]?.tweetIds).toEqual([])
    expect(searchQueryOf(state, claudeCode)).toBe('claude code')
    expect(isSearchTab(claudeCode)).toBe(true)
    expect(isSearchTab('following')).toBe(false)
  })

  test('the same words a second time win the tab back instead of making another', () => {
    const first = withTab()
    const again = addSearchTab({ ...first, activeTab: 'following' }, '  Claude Code ')
    expect(again.searchTabs).toHaveLength(1)
    expect(again.activeTab).toBe(claudeCode)
    expect(searchTabIdOf('  Claude Code ')).toBe(claudeCode)
  })

  test('a query of spaces alone is no query, so nothing opens', () => {
    const state = addSearchTab(initialAppState(), '   ')
    expect(state.searchTabs).toEqual([])
    expect(state.activeTab).toBe('following')
  })

  test('closing it takes its list with it and lands on the tab before it', () => {
    let state = withTab()
    state = mergeTimelinePage(state, claudeCode, [tweet('1')], { bottomCursor: 'page-two' })
    expect(state.timelines[claudeCode]?.tweetIds).toEqual(['1'])
    const closed = removeSearchTab(state, claudeCode)
    expect(closed.searchTabs).toEqual([])
    expect(closed.timelines[claudeCode]).toBeUndefined()
    expect(closed.activeTab).toBe('notifications')
    // The tweet itself stays: another tab can draw the same one.
    expect(closed.tweets['1']).toBeDefined()
  })

  test('closing a tab that is not open leaves the open one where it is', () => {
    const state = addSearchTab(withTab(), 'opentui')
    const closed = removeSearchTab(state, claudeCode)
    expect(closed.activeTab).toBe('search:opentui')
    expect(closed.searchTabs.map((entry) => entry.query)).toEqual(['opentui'])
  })

  test('the tabs of the last run come back in the same order, and come back empty', () => {
    let state = initialAppState()
    for (const query of ['claude code', 'opentui']) {
      state = addSearchTab(state, query)
    }
    expect(state.searchTabs.map((entry) => entry.query)).toEqual(['claude code', 'opentui'])
    expect(state.timelines[claudeCode]?.tweetIds).toEqual([])
    expect(state.timelines['search:opentui']?.tweetIds).toEqual([])
  })

  test('Tab walks the added tabs after the fixed three, and wraps', () => {
    const state = addSearchTab(withTab(), 'opentui')
    expect(tabOrder(state)).toEqual(['following', 'forYou', 'notifications', claudeCode, 'search:opentui'])
    expect(nextTab({ ...state, activeTab: 'notifications' })).toBe(claudeCode)
    expect(nextTab({ ...state, activeTab: claudeCode })).toBe('search:opentui')
    expect(nextTab({ ...state, activeTab: 'search:opentui' })).toBe('following')
  })
})

describe('what the screen says about a tab the reader added', () => {
  test('the query is the name, on the rail and over the timeline', () => {
    const state = withTab()
    expect(tabName(state, claudeCode)).toBe('claude code')
    expect(railTabs(state)).toContain('● claude code')
    expect(railTabs(state)).toContain('/ adds a tab')
    // A search carries no sort menu, so naming one would promise a key it does not have.
    expect(timelineTitle(state, claudeCode, 12)).toBe('claude code · 12 tweets')
  })

  test('a query too wide for the rail is cut, never wrapped onto a line of its own', () => {
    expect(railLabel('claude code')).toBe('claude code')
    expect(railLabel('a very long search indeed')).toBe('a very long s…')
    expect(railLabel('a very long search indeed').length).toBe(14)
  })

  test('the drawer says it is making a tab, and counts no characters', () => {
    const heading = composerHeading(openComposer(initialAppState(), 'search'))
    expect(heading).toBe('New tab · type a search · Enter opens it · Esc closes')
    expect(heading).not.toContain('280')
  })
})

describe('the search X answers', () => {
  test('asks for the latest posts on the raw query and reads both cursors', async () => {
    const asked: URL[] = []
    const fetchMock = async (input: RequestInfo | URL): Promise<Response> => {
      const url = new URL(input.toString())
      if (!url.pathname.includes('SearchTimeline')) {
        return textResponse('', { status: 404 })
      }
      asked.push(url)
      return jsonResponse(searchBody([makeTweetResult('10', 'alice', 'claude code is fast')]))
    }
    const client = new TwitterClient({ authToken: 'auth', ct0: 'csrf', fetch: fetchMock, graphQLBase: 'https://x.com/i/api/graphql' })
    const page = await client.loadSearchPage({ query: 'claude code', count: 20 })
    const variables = JSON.parse(asked[0]?.searchParams.get('variables') ?? '{}') as Record<string, unknown>
    expect(variables.rawQuery).toBe('claude code')
    expect(variables.product).toBe('Latest')
    expect(variables.querySource).toBe('typed_query')
    expect(variables).not.toHaveProperty('cursor')
    expect(page.tweets.map((found) => found.id)).toEqual(['10'])
    expect(page.topCursor).toBe('search-top')
    expect(page.bottomCursor).toBe('search-bottom')
  })

  test('a page down carries the cursor it was given', async () => {
    const asked: URL[] = []
    const fetchMock = async (input: RequestInfo | URL): Promise<Response> => {
      const url = new URL(input.toString())
      if (!url.pathname.includes('SearchTimeline')) {
        return textResponse('', { status: 404 })
      }
      asked.push(url)
      return jsonResponse(searchBody([]))
    }
    const client = new TwitterClient({ authToken: 'auth', ct0: 'csrf', fetch: fetchMock, graphQLBase: 'https://x.com/i/api/graphql' })
    await client.loadSearchPage({ query: 'claude code', count: 20, cursor: 'search-bottom' })
    const variables = JSON.parse(asked[0]?.searchParams.get('variables') ?? '{}') as Record<string, unknown>
    expect(variables.cursor).toBe('search-bottom')
  })
})
