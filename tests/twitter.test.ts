import { describe, expect, test } from 'bun:test'
import { HeaderBuilder } from '../src/twitter/headers.ts'
import { extractMedia } from '../src/twitter/extract/media.ts'
import { parseConversationTweets, parseHomeTweets, parseTweetsFromInstructions, upsizeAvatar } from '../src/twitter/extract/tweet.ts'
import { chunkUrlOf, findOperationId } from '../src/twitter/queryIds.ts'
import { TwitterClient } from '../src/twitter/client.ts'
import { tweetUrl } from '../src/media/openExternal.ts'
import { asReplyTo, asRepost, homeConversationEntry, homeEntries, homeTweetEntry, jsonResponse, makeTweetResult, promotedThreadEntry, promotedTweetEntry, relatedTweetsEntry, textResponse, timelineBody, tweetDetailBody, videoEntity, withQuotedTweet } from './helpers.ts'
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

  test('keeps the tweet a home conversation starts from and drops the replies under it', () => {
    const root = makeTweetResult('1', 'alice', 'the drought is bad')
    const reply = asReplyTo(makeTweetResult('2', 'bob', '@alice drill a well'), '1')
    const second = asReplyTo(makeTweetResult('3', 'carol', '@bob good idea'), '2')
    const tweets = parseHomeTweets(homeEntries([homeConversationEntry([root, reply, second])]))

    expect(tweets.map((tweet) => tweet.id)).toEqual(['1'])
    expect(tweets[0]?.author.handle).toBe('alice')
  })

  test('keeps a plain timeline tweet that answers something, because nothing repeats it', () => {
    const lone = asReplyTo(makeTweetResult('9', 'dave', '@someone yes'), '8')
    expect(parseHomeTweets(homeEntries([homeTweetEntry(lone)])).map((tweet) => tweet.id)).toEqual(['9'])
  })

  test('keeps the first tweet of a conversation module built from replies alone', () => {
    const first = asReplyTo(makeTweetResult('5', 'alice', '@x one'), '4')
    const later = asReplyTo(makeTweetResult('6', 'bob', '@alice two'), '5')
    expect(parseHomeTweets(homeEntries([homeConversationEntry([first, later])])).map((tweet) => tweet.id)).toEqual(['5'])
  })

  test('drops the ads X mixes into the feed', () => {
    const entries = [
      homeTweetEntry(makeTweetResult('1', 'alice', 'hello')),
      promotedTweetEntry(makeTweetResult('2', 'brand', 'buy this')),
      homeTweetEntry(makeTweetResult('3', 'bob', 'morning'))
    ]
    expect(parseHomeTweets(homeEntries(entries)).map((tweet) => tweet.id)).toEqual(['1', '3'])
  })

  test('shows a tweet once when it arrives both on its own and inside a conversation', () => {
    const root = makeTweetResult('1', 'alice', 'hello')
    const entries = [homeTweetEntry(root), homeConversationEntry([root, asReplyTo(makeTweetResult('2', 'bob', '@alice hi'), '1')])]
    expect(parseHomeTweets(homeEntries(entries)).map((tweet) => tweet.id)).toEqual(['1'])
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

  // The analytics page is a Relay app, and Relay writes the pair the other way about.
  test('finds an operation id a Relay query names in its own way', () => {
    const source = 'params:{id:"_P1caq0YB4SVuEtFLPDMfQ",metadata:{},name:"accountOverviewDailyQuery",operationKind:"query",text:null}'
    expect(findOperationId(source, 'accountOverviewDailyQuery')).toBe('_P1caq0YB4SVuEtFLPDMfQ')
  })
})

// A chunk nothing on the page links still has a name and a hash in the loader, and that is
// enough to ask for it.
describe('the lazy chunks of the x.com shell', () => {
  const shell = [
    'var p={};p.u=e=>""+(({7:"bundle.AccountAnalytics",8:"bundle.Other"})[e]||e)+"."+({7:"9f0d1c2",8:"aaa1111"})[e]+"a.js";',
    'p.p="https://abs.twimg.test/responsive-web/client-web/";'
  ].join('')

  test('a named chunk becomes a url', () => {
    expect(chunkUrlOf(shell, 'bundle.AccountAnalytics')).toBe('https://abs.twimg.test/responsive-web/client-web/bundle.AccountAnalytics.9f0d1c2a.js')
  })

  test('a chunk the loader never names has no url', () => {
    expect(chunkUrlOf(shell, 'bundle.Missing')).toBeUndefined()
  })

  test('a page without the loader has no url either', () => {
    expect(chunkUrlOf('<html></html>', 'bundle.AccountAnalytics')).toBeUndefined()
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

  test('sends the sort as enableRanking, and only on the Following feed', async () => {
    const captured: { operation: string; variables: Record<string, unknown> }[] = []
    const fetchMock = async (input: RequestInfo | URL): Promise<Response> => {
      const url = new URL(input.toString())
      if (!url.pathname.includes('/graphql/')) {
        return textResponse('', { status: 404 })
      }
      const operation = url.pathname.split('/').pop() ?? ''
      captured.push({ operation, variables: JSON.parse(url.searchParams.get('variables') ?? '{}') as Record<string, unknown> })
      return jsonResponse(timelineBody([makeTweetResult('10', 'alice', 'root')]))
    }
    const client = new TwitterClient({ authToken: 'auth', ct0: 'csrf', fetch: fetchMock, graphQLBase: 'https://x.com/i/api/graphql' })
    await client.loadHomeTimelinePage({ count: 20, following: true })
    await client.loadHomeTimelinePage({ count: 20, following: true, ranked: true })
    await client.loadHomeTimelinePage({ count: 20, following: false, ranked: true })
    expect(captured.map((call) => call.operation)).toEqual(['HomeLatestTimeline', 'HomeLatestTimeline', 'HomeTimeline'])
    expect(captured[0]?.variables.enableRanking).toBe(false)
    expect(captured[1]?.variables.enableRanking).toBe(true)
    expect(captured[2]?.variables).not.toHaveProperty('enableRanking')
  })

  test('reads the follower history from the analytics query', async () => {
    const asked: URL[] = []
    const fetchMock = async (input: RequestInfo | URL): Promise<Response> => {
      const url = new URL(input.toString())
      if (!url.pathname.includes('accountOverviewDailyQuery')) {
        return textResponse('', { status: 404 })
      }
      asked.push(url)
      return jsonResponse({
        data: {
          viewer_v2: {
            user_results: {
              result: {
                current_time_series: [
                  { engagement_type: 'Follow', count: 7, timestamp: Date.parse('2026-08-04T00:00:00Z') },
                  { engagement_type: 'Unfollow', count: 2, timestamp: Date.parse('2026-08-04T00:00:00Z') }
                ],
                hourly_backfill: []
              }
            }
          }
        }
      })
    }
    const client = new TwitterClient({ authToken: 'auth', ct0: 'csrf', fetch: fetchMock, graphQLBase: 'https://x.com/i/api/graphql' })
    const history = await client.loadFollowerHistory({ days: 7, now: new Date('2026-08-08T10:00:00Z') })
    expect(asked).toHaveLength(1)
    expect(asked[0]?.searchParams.get('features')).toBe('{}')
    expect(history['2026-08-04']).toEqual({ follows: 7, unfollows: 2 })
    expect(history['2026-08-03']).toEqual({ follows: 0, unfollows: 0 })
    // A day more than the rows ask for, because a local day can sit outside the UTC window.
    expect(Object.keys(history)).toHaveLength(8)
    expect(history['2026-08-01']).toEqual({ follows: 0, unfollows: 0 })
  })

  test('keeps Discover more tweets and injected ads out of the replies', async () => {
    const focal = makeTweetResult('10', 'alice', 'root')
    const reply = makeTweetResult('11', 'bob', 'reply')
    const discovered = makeTweetResult('12', 'carol', 'sourced from across X')
    const ad = makeTweetResult('13', 'brand', 'buy this')
    const body = tweetDetailBody(focal, [reply], [relatedTweetsEntry(discovered), promotedThreadEntry(ad)])
    const fetchMock = async (input: RequestInfo | URL): Promise<Response> => {
      return input.toString().includes('TweetDetail') ? jsonResponse(body) : jsonResponse({}, { status: 404 })
    }
    const client = new TwitterClient({ authToken: 'auth', ct0: 'csrf', fetch: fetchMock, graphQLBase: 'https://x.com/i/api/graphql' })
    const page = await client.loadRepliesPage({ tweetId: '10' })
    expect(page.replies.map((tweet) => tweet.id)).toEqual(['11'])
    const bundle = await client.getTweet('10')
    expect(bundle.tweet.id).toBe('10')
    expect(bundle.related.map((tweet) => tweet.id)).toEqual(['11'])
  })

  test('a module reply entry still yields its tweets', () => {
    const instructions = [{
      entries: [{
        entryId: 'conversationthread-20',
        content: { items: [
          { entryId: 'conversationthread-20-tweet-20', item: { itemContent: { tweet_results: { result: makeTweetResult('20', 'dan', 'first') } } } },
          { entryId: 'conversationthread-20-tweet-21', item: { itemContent: { tweet_results: { result: makeTweetResult('21', 'dan', 'second') } } } }
        ] }
      }]
    }]
    expect(parseConversationTweets(instructions).map((tweet) => tweet.id)).toEqual(['20', '21'])
  })

  test('the browser fingerprint headers ride on every request', () => {
    const builder = new HeaderBuilder({ authToken: 'auth', ct0: 'csrf' })
    const headers = builder.jsonHeaders() as Record<string, string>
    // Without these X answers a write with error 226, "this request looks automated".
    expect(headers['sec-fetch-site']).toBe('same-origin')
    expect(headers['sec-ch-ua-platform']).toBe('"macOS"')
  })

  test('never sends a made-up x-client-transaction-id', () => {
    const builder = new HeaderBuilder({ authToken: 'auth', ct0: 'csrf' })
    // X validates this header. A fabricated value fails the automation gate every time,
    // so the header has to be absent until it can be derived like the browser derives it.
    expect((builder.jsonHeaders() as Record<string, string>)['x-client-transaction-id']).toBeUndefined()
    expect((builder.htmlHeaders() as Record<string, string>)['x-client-transaction-id']).toBeUndefined()
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
