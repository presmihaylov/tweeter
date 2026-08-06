import { describe, expect, test } from 'bun:test'
import { cursorFor, feedLoadResult } from '../src/app/terminalApp.ts'
import { initialAppState, mergeTimelinePage, needsOlderTweets, selectRelativeTweet } from '../src/state/store.ts'
import type { AppTweet } from '../src/twitter/types.ts'
import type { TimelineState } from '../src/state/store.ts'

const tweet = (id: string): AppTweet => ({
  id,
  text: `tweet ${id}`,
  author: { handle: `u${id}`, name: `U${id}` },
  media: [],
  metrics: {}
})

const tweets = (...ids: string[]): AppTweet[] => ids.map(tweet)

const timeline = (topCursor?: string, bottomCursor?: string): TimelineState => ({
  id: 'following',
  tweetIds: [],
  loading: false,
  ...(topCursor === undefined ? {} : { topCursor }),
  ...(bottomCursor === undefined ? {} : { bottomCursor })
})

describe('where a fetched page lands', () => {
  test('puts what arrived since above the page the reader already has', () => {
    const first = mergeTimelinePage(initialAppState(), 'following', tweets('3', '2', '1'), { topCursor: 'top-1', bottomCursor: 'bottom-1' })
    const refreshed = mergeTimelinePage(first, 'following', tweets('5', '4'), { topCursor: 'top-2', bottomCursor: 'bottom-2' }, 'top')
    expect(refreshed.timelines.following.tweetIds).toEqual(['5', '4', '3', '2', '1'])
  })

  test('puts the next page down below it', () => {
    const first = mergeTimelinePage(initialAppState(), 'following', tweets('3', '2'), { topCursor: 'top-1', bottomCursor: 'bottom-1' })
    const older = mergeTimelinePage(first, 'following', tweets('2', '1'), { topCursor: 'top-2', bottomCursor: 'bottom-2' }, 'bottom')
    // Two pages overlap in time, so a tweet on both keeps the place it already has.
    expect(older.timelines.following.tweetIds).toEqual(['3', '2', '1'])
  })

  test('lets each cursor move only in its own direction', () => {
    const first = mergeTimelinePage(initialAppState(), 'following', tweets('2', '1'), { topCursor: 'top-1', bottomCursor: 'bottom-1' })
    expect(first.timelines.following.topCursor).toBe('top-1')
    expect(first.timelines.following.bottomCursor).toBe('bottom-1')

    // A page pulled from the bottom names its own top, not the newest tweet. Taking that
    // top would make the next refresh skip backwards over everything in between.
    const older = mergeTimelinePage(first, 'following', tweets('0'), { topCursor: 'top-2', bottomCursor: 'bottom-2' }, 'bottom')
    expect(older.timelines.following.topCursor).toBe('top-1')
    expect(older.timelines.following.bottomCursor).toBe('bottom-2')

    const newer = mergeTimelinePage(older, 'following', tweets('3'), { topCursor: 'top-3', bottomCursor: 'bottom-3' }, 'top')
    expect(newer.timelines.following.topCursor).toBe('top-3')
    expect(newer.timelines.following.bottomCursor).toBe('bottom-2')
  })

  test('drops the bottom cursor at the end of the feed, so nothing asks again', () => {
    const first = mergeTimelinePage(initialAppState(), 'following', tweets('2', '1'), { bottomCursor: 'bottom-1' })
    const end = mergeTimelinePage(first, 'following', tweets('2', '1'), { bottomCursor: 'bottom-2' }, 'bottom')
    expect(end.timelines.following.bottomCursor).toBeUndefined()
    expect(needsOlderTweets(end)).toBe(false)
  })

  test('leaves the top cursor alone when a refresh finds nothing', () => {
    const first = mergeTimelinePage(initialAppState(), 'following', tweets('2', '1'), { topCursor: 'top-1', bottomCursor: 'bottom-1' })
    const empty = mergeTimelinePage(first, 'following', [], {}, 'top')
    expect(empty.timelines.following.tweetIds).toEqual(['2', '1'])
    expect(empty.timelines.following.topCursor).toBe('top-1')
    expect(empty.timelines.following.bottomCursor).toBe('bottom-1')
  })
})

describe('which cursor a load sends', () => {
  test('sends none on the first page, the top on a refresh, the bottom on an older page', () => {
    const state = timeline('top-1', 'bottom-1')
    expect(cursorFor(state, 'initial')).toBeUndefined()
    expect(cursorFor(state, 'newer')).toBe('top-1')
    expect(cursorFor(state, 'older')).toBe('bottom-1')
  })

  test('reports an empty refresh as no new tweets', () => {
    expect(feedLoadResult('newer', 0)).toBe('no new tweets')
    expect(feedLoadResult('newer', 6)).toBe('6 new tweets')
    expect(feedLoadResult('older', 40)).toBe('40 older tweets')
    expect(feedLoadResult('initial', 40)).toBe('loaded 40 tweets')
  })
})

describe('the older page trigger', () => {
  test('fires once the selection comes within five cards of the end', () => {
    const ids = Array.from({ length: 12 }, (_value, index) => String(index + 1))
    let state = mergeTimelinePage(initialAppState(), 'following', tweets(...ids), { bottomCursor: 'next' })
    expect(needsOlderTweets(state)).toBe(false)
    // Card 8 of 12 is the eighth from the top and the fifth from the end.
    state = selectRelativeTweet(state, 6)
    expect(state.selectedTweetId).toBe('7')
    expect(needsOlderTweets(state)).toBe(false)
    state = selectRelativeTweet(state, 1)
    expect(state.selectedTweetId).toBe('8')
    expect(needsOlderTweets(state)).toBe(true)
  })

  test('stays quiet with no cursor, with a load already out, and on an empty feed', () => {
    const ids = Array.from({ length: 3 }, (_value, index) => String(index + 1))
    const state = mergeTimelinePage(initialAppState(), 'following', tweets(...ids), {})
    expect(needsOlderTweets(state)).toBe(false)
    const paged = mergeTimelinePage(initialAppState(), 'following', tweets(...ids), { bottomCursor: 'next' })
    expect(needsOlderTweets(paged)).toBe(true)
    expect(needsOlderTweets({ ...paged, timelines: { ...paged.timelines, following: { ...paged.timelines.following, loading: true } } })).toBe(false)
    expect(needsOlderTweets(initialAppState())).toBe(false)
  })
})
