import { describe, expect, test } from 'bun:test'
import { initialAppState, mergeTimelinePage, selectRelativeTweet } from '../src/state/store.ts'
import { buildChafaArgs } from '../src/media/chafaRenderer.ts'
import { mediaCachePath } from '../src/media/cache.ts'
import type { AppTweet } from '../src/twitter/types.ts'

const tweet = (id: string): AppTweet => ({ id, text: `tweet ${id}`, author: { handle: `u${id}`, name: `U${id}` }, media: [], metrics: {} })

describe('state and media', () => {
  test('merges timeline and moves selection', () => {
    let state = initialAppState()
    state = mergeTimelinePage(state, 'following', [tweet('1'), tweet('2')], { bottomCursor: 'b' })
    expect(state.selectedTweetId).toBe('1')
    state = selectRelativeTweet(state, 1)
    expect(state.selectedTweetId).toBe('2')
    expect(state.timelines.following.bottomCursor).toBe('b')
  })

  test('builds chafa args', () => {
    expect(buildChafaArgs('/tmp/a.png', { cols: 10, rows: 5 })).toEqual(['--format=symbols', '--size=10x5', '/tmp/a.png'])
  })

  test('media cache path is stable', () => {
    expect(mediaCachePath('https://example.com/a.jpg', '/tmp/cache')).toMatch(/\/tmp\/cache\/original\/[a-f0-9]{64}\.jpg$/)
  })
})
