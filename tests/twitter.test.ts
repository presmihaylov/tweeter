import { describe, expect, test } from 'bun:test'
import { HeaderBuilder } from '../src/twitter/headers.ts'
import { extractMedia } from '../src/twitter/extract/media.ts'
import { parseTweetsFromInstructions } from '../src/twitter/extract/tweet.ts'
import { findOperationId } from '../src/twitter/queryIds.ts'
import { TwitterClient } from '../src/twitter/client.ts'
import { jsonResponse, makeTweetResult, textResponse, timelineBody, tweetDetailBody } from './helpers.ts'

describe('twitter primitives', () => {
  test('headers contain cookie and csrf', () => {
    const builder = new HeaderBuilder({ authToken: 'auth', ct0: 'csrf', clientUuid: 'uuid', clientDeviceId: 'device' })
    const headers = builder.jsonHeaders() as Record<string, string>
    expect(headers.cookie).toBe('auth_token=auth; ct0=csrf')
    expect(headers['x-csrf-token']).toBe('csrf')
    expect(headers.authorization?.startsWith('Bearer ')).toBe(true)
  })

  test('extracts best video media variant', () => {
    const result = makeTweetResult('1', 'alice', 'hi', [{
      type: 'video',
      media_url_https: 'https://pbs.twimg.com/video.jpg',
      sizes: { large: { w: 640, h: 360 } },
      video_info: { duration_millis: 1000, variants: [
        { content_type: 'video/mp4', url: 'low.mp4', bitrate: 128000 },
        { content_type: 'video/mp4', url: 'high.mp4', bitrate: 832000 }
      ] }
    }])
    const media = extractMedia(result)
    expect(media[0]?.type).toBe('video')
    if (media[0]?.type === 'video') {
      expect(media[0].videoUrl).toBe('high.mp4')
    }
  })

  test('parses timeline instructions', () => {
    const body = timelineBody([makeTweetResult('1', 'alice', 'hello')])
    const instructions = (body as { data: { home: { home_timeline_urt: { instructions: unknown[] } } } }).data.home.home_timeline_urt.instructions
    const tweets = parseTweetsFromInstructions(instructions)
    expect(tweets).toHaveLength(1)
    expect(tweets[0]?.author.handle).toBe('alice')
  })

  test('finds operation ids in bundle text', () => {
    expect(findOperationId('operationName:"HomeTimeline",queryId:"abcDEF_123456"', 'HomeTimeline')).toBe('abcDEF_123456')
  })
})

describe('TwitterClient read paths', () => {
  test('auth, timeline, and replies use expected flows', async () => {
    const focal = makeTweetResult('10', 'alice', 'root')
    const reply = makeTweetResult('11', 'bob', 'reply')
    const fetchMock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = input.toString()
      if (url.includes('account/settings')) {
        return textResponse('{"screen_name":"me","user_id":"42","name":"Me"}')
      }
      if (url.includes('HomeLatestTimeline')) {
        expect(init?.method).toBe('GET')
        return jsonResponse(timelineBody([focal]))
      }
      if (url.includes('TweetDetail')) {
        return jsonResponse(tweetDetailBody(focal, [reply]))
      }
      return jsonResponse({}, { status: 404 })
    }
    const client = new TwitterClient({ authToken: 'auth', ct0: 'csrf', fetch: fetchMock, graphQLBase: 'https://x.com/i/api/graphql' })
    const auth = await client.checkAuth()
    expect(auth.ok).toBe(true)
    const page = await client.loadHomeTimelinePage({ count: 20, following: true })
    expect(page.tweets[0]?.id).toBe('10')
    const replies = await client.loadRepliesPage({ tweetId: '10' })
    expect(replies.replies[0]?.id).toBe('11')
  })

  test('TwitterClient has no write methods (writes go through OfficialXApiClient)', () => {
    const client = new TwitterClient({ authToken: 'a', ct0: 'c' })
    expect('reply' in client).toBe(false)
    expect('tweet' in client).toBe(false)
  })
})
