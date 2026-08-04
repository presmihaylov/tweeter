import { describe, expect, test } from 'bun:test'
import { HeaderBuilder } from '../src/twitter/headers.ts'
import { extractMedia } from '../src/twitter/extract/media.ts'
import { parseTweetsFromInstructions, upsizeAvatar } from '../src/twitter/extract/tweet.ts'
import { findOperationId } from '../src/twitter/queryIds.ts'
import { TwitterClient } from '../src/twitter/client.ts'
import { tweetUrl } from '../src/media/openExternal.ts'
import { asRepost, jsonResponse, makeTweetResult, textResponse, timelineBody, tweetDetailBody, videoEntity, withQuotedTweet } from './helpers.ts'
import type { AppTweet } from '../src/twitter/types.ts'

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

  test('reads the author avatar and verified badge', () => {
    const result = makeTweetResult('1', 'alice', 'hi')
    const user = (result as { core: { user_results: { result: Record<string, unknown> } } }).core.user_results.result
    user.avatar = { image_url: 'https://pbs.twimg.test/profile_images/7/pic_normal.jpg' }
    user.is_blue_verified = true
    const tweets = parseTweetsFromInstructions([{ entries: [{ content: { itemContent: { tweet_results: { result } } } }] }])
    expect(tweets[0]?.author.avatarUrl).toBe('https://pbs.twimg.test/profile_images/7/pic_400x400.jpg')
    expect(tweets[0]?.author.verified).toBe(true)
  })

  test('leaves an avatar url alone when it carries no size suffix', () => {
    expect(upsizeAvatar('https://pbs.twimg.test/profile_images/7/pic.jpg')).toBe('https://pbs.twimg.test/profile_images/7/pic.jpg')
    expect(upsizeAvatar('')).toBe('')
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

  test('the browser fingerprint headers ride on every request', () => {
    const builder = new HeaderBuilder({ authToken: 'auth', ct0: 'csrf' })
    const headers = builder.jsonHeaders() as Record<string, string>
    // Without these X answers a write with error 226, "this request looks automated".
    expect(headers['sec-fetch-site']).toBe('same-origin')
    expect(headers['sec-ch-ua-platform']).toBe('"macOS"')
    expect(headers['x-client-transaction-id']?.length).toBeGreaterThan(40)
  })

  test('html headers carry the cookie but not the API bearer', () => {
    const builder = new HeaderBuilder({ authToken: 'auth', ct0: 'csrf' })
    const headers = builder.htmlHeaders() as Record<string, string>
    expect(headers.cookie).toBe('auth_token=auth; ct0=csrf')
    expect(headers.authorization).toBeUndefined()
  })
})

describe('tweet url', () => {
  const base = {
    id: '1234567890',
    text: 'hello',
    author: { handle: 'someone', name: 'Some One' },
    media: [],
    metrics: {}
  }

  test('builds the canonical x.com status url', () => {
    expect(tweetUrl(base)).toBe('https://x.com/someone/status/1234567890')
  })

  test('falls back to the /i segment when the handle is missing', () => {
    expect(tweetUrl({ ...base, author: { handle: '', name: '' } })).toBe('https://x.com/i/status/1234567890')
  })
})

describe('quoted tweets', () => {
  const photo = {
    type: 'photo',
    media_url_https: 'https://pbs.twimg.test/media/chart.jpg',
    sizes: { large: { w: 1200, h: 800 } }
  }

  test('nests the quoted tweet with its own author and media', () => {
    const quoted = makeTweetResult('222', 'quoted_user', 'the original post', [photo])
    const outer = withQuotedTweet(makeTweetResult('111', 'quoting_user', 'this explains everything'), quoted)
    const tweets = parseTweetsFromInstructions([{ entries: [{ entryId: 'e', content: { itemContent: { tweet_results: { result: outer } } } }] }])
    expect(tweets).toHaveLength(1)
    expect(tweets[0]?.quotedTweetId).toBe('222')
    expect(tweets[0]?.quotedTweet?.author.handle).toBe('quoted_user')
    expect(tweets[0]?.quotedTweet?.text).toBe('the original post')
    expect(tweets[0]?.quotedTweet?.media[0]?.width).toBe(1200)
  })

  test('stops after one level of quoting', () => {
    const inner = makeTweetResult('333', 'inner_user', 'innermost')
    const middle = withQuotedTweet(makeTweetResult('222', 'quoted_user', 'middle'), inner)
    const outer = withQuotedTweet(makeTweetResult('111', 'quoting_user', 'outer'), middle)
    const tweets = parseTweetsFromInstructions([{ entries: [{ entryId: 'e', content: { itemContent: { tweet_results: { result: outer } } } }] }])
    expect(tweets[0]?.quotedTweet?.id).toBe('222')
    expect(tweets[0]?.quotedTweet?.quotedTweet).toBeUndefined()
  })
})

describe('reposts', () => {
  const parse = (result: unknown): AppTweet[] =>
    parseTweetsFromInstructions([{ entries: [{ entryId: 'e', content: { itemContent: { tweet_results: { result } } } }] }])

  const repost = (): unknown => {
    const original = makeTweetResult('222', 'author_user', 'the whole original text, all of it', [videoEntity()])
    const wrapper = makeTweetResult('111', 'reposting_user', 'RT @author_user: the whole original text, all of…')
    return asRepost(wrapper, original)
  }

  test('shows the original tweet, not the truncated wrapper', () => {
    const tweets = parse(repost())
    expect(tweets).toHaveLength(1)
    expect(tweets[0]?.id).toBe('222')
    expect(tweets[0]?.text).toBe('the whole original text, all of it')
    expect(tweets[0]?.author.handle).toBe('author_user')
  })

  test('keeps the media the wrapper never carried', () => {
    expect(parse(repost())[0]?.media[0]?.type).toBe('video')
  })

  test('keeps the counts of the original, so the replies are findable', () => {
    expect(parse(repost())[0]?.metrics.replies).toBe(1)
    expect(parse(repost())[0]?.conversationId).toBe('222')
  })

  test('names whoever reposted it', () => {
    expect(parse(repost())[0]?.repostedBy).toEqual({ handle: 'reposting_user', name: 'REPOSTING_USER' })
  })

  test('a plain tweet is not marked as a repost', () => {
    expect(parse(makeTweetResult('111', 'author_user', 'plain'))[0]?.repostedBy).toBeUndefined()
  })
})

describe('video media', () => {
  test('takes the highest-bitrate mp4 and the poster frame', () => {
    const media = extractMedia({ legacy: { extended_entities: { media: [videoEntity()] } } })
    expect(media[0]).toEqual({
      type: 'video',
      url: 'https://pbs.twimg.test/amplify/poster.jpg',
      previewUrl: 'https://pbs.twimg.test/amplify/poster.jpg:small',
      width: 1920,
      height: 1080,
      videoUrl: 'https://video.twimg.test/high.mp4',
      durationMs: 1322400
    })
  })
})
