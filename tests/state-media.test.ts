import { describe, expect, test } from 'bun:test'
import { initialAppState, mergeTimelinePage, previewOf, selectRelativeTweet, toggleLightbox, videoOf } from '../src/state/store.ts'
import { formatMedia } from '../src/app/mainScreen.ts'
import { buildChafaArgs } from '../src/media/chafaRenderer.ts'
import { mediaCachePath } from '../src/media/cache.ts'
import type { AppMedia, AppTweet } from '../src/twitter/types.ts'

const tweet = (id: string): AppTweet => ({ id, text: `tweet ${id}`, author: { handle: `u${id}`, name: `U${id}` }, media: [], metrics: {} })
const photo: AppMedia = { type: 'photo', url: 'https://pbs.twimg.test/media/one.jpg', width: 1200, height: 800 }
const withPhoto = (id: string): AppTweet => ({ ...tweet(id), media: [photo] })

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

describe('video media', () => {
  const video: AppMedia = { type: 'video', url: 'https://pbs.twimg.test/poster.jpg', videoUrl: 'https://video.twimg.test/high.mp4', width: 1920, height: 1080, durationMs: 1322400 }
  const withVideo = (id: string): AppTweet => ({ ...tweet(id), media: [video] })

  test('a video offers its poster frame to the pane', () => {
    expect(previewOf(withVideo('1'))).toEqual(video)
  })

  test('a video offers its mp4 to the system player', () => {
    expect(videoOf(withVideo('1'))).toEqual(video)
    expect(videoOf(withPhoto('1'))).toBeUndefined()
    expect(videoOf(undefined)).toBeUndefined()
  })

  test('the caption states the length and the key that plays it', () => {
    expect(formatMedia(video)).toBe('video 1920×1080 · 22:02 · v plays it')
    expect(formatMedia(photo)).toBe('photo 1200×800')
  })
})

describe('lightbox', () => {
  test('picks the first photo and ignores other media', () => {
    expect(previewOf(withPhoto('1'))).toEqual(photo)
    expect(previewOf(tweet('1'))).toBeUndefined()
    expect(previewOf(undefined)).toBeUndefined()
  })

  test('opens with the photo url, size and caption', () => {
    const state = toggleLightbox(initialAppState(), withPhoto('1'), photo)
    expect(state.lightbox).toEqual({ key: 'lightbox:1', url: photo.url, label: '@u1 · photo 1200×800', width: 1200, height: 800 })
  })

  test('closes when the same photo is opened again', () => {
    const open = toggleLightbox(initialAppState(), withPhoto('1'), photo)
    expect(toggleLightbox(open, withPhoto('1'), photo).lightbox).toBeUndefined()
  })

  test('swaps straight to another photo', () => {
    const open = toggleLightbox(initialAppState(), withPhoto('1'), photo)
    expect(toggleLightbox(open, withPhoto('2'), photo).lightbox?.key).toBe('lightbox:2')
  })

  test('closes on an empty toggle and leaves a closed lightbox alone', () => {
    const open = toggleLightbox(initialAppState(), withPhoto('1'), photo)
    expect(toggleLightbox(open, undefined, undefined).lightbox).toBeUndefined()
    const closed = initialAppState()
    expect(toggleLightbox(closed, undefined, undefined)).toBe(closed)
  })

  test('closes when the selection moves', () => {
    let state = mergeTimelinePage(initialAppState(), 'following', [withPhoto('1'), withPhoto('2')], {})
    state = toggleLightbox(state, withPhoto('1'), photo)
    expect(selectRelativeTweet(state, 1).lightbox).toBeUndefined()
  })
})
