import { describe, expect, test } from 'bun:test'
import { timelineTitle } from '../src/app/mainScreen.ts'
import { initialAppState, mergeTimelinePage, setFeedSort } from '../src/state/store.ts'
import type { AppTweet } from '../src/twitter/types.ts'

const tweet = (id: string): AppTweet => ({
  id,
  text: `tweet ${id}`,
  author: { handle: `u${id}`, name: `U${id}` },
  media: [],
  metrics: {}
})

describe('the feed sort', () => {
  test('starts on Recent, which is what X gives a client that asks for nothing', () => {
    expect(initialAppState().feedSort).toBe('recent')
  })

  test('drops the loaded page and its cursor, because the cursor indexes the old order', () => {
    let state = mergeTimelinePage(initialAppState(), 'following', [tweet('1'), tweet('2')], { bottomCursor: 'page-two' })
    state = mergeTimelinePage(state, 'forYou', [tweet('3')], { bottomCursor: 'other-page' })
    expect(state.selectedTweetId).toBe('1')
    const sorted = setFeedSort(state, 'popular')
    expect(sorted.feedSort).toBe('popular')
    expect(sorted.timelines.following.tweetIds).toEqual([])
    expect(sorted.timelines.following.bottomCursor).toBeUndefined()
    expect(sorted.selectedTweetId).toBeUndefined()
    expect(sorted.detailStack).toEqual([])
    // For You has no sort menu, so its page survives the keystroke.
    expect(sorted.timelines.forYou.tweetIds).toEqual(['3'])
    expect(sorted.timelines.forYou.bottomCursor).toBe('other-page')
  })

  test('names the sort on Following and stays quiet about it on For You', () => {
    const recent = initialAppState()
    const popular = setFeedSort(recent, 'popular')
    expect(timelineTitle(recent, 'following', 77)).toBe('Following · Recent · 77 tweets')
    expect(timelineTitle(popular, 'following', 31)).toBe('Following · Popular · 31 tweets')
    expect(timelineTitle(popular, 'forYou', 40)).toBe('For You · 40 tweets')
  })
})
