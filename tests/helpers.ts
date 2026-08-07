import transactionIdFixture from './fixtures/transactionId.json' with { type: 'json' }

// The signed-in shell, cut down to the two parts the transaction id needs: the verification
// key and the four animation SVGs. The SVGs are the real ones; the key is random bytes.
export const shellHtml = (extra = ''): string =>
  `<html><head><meta name="twitter-site-verification" content="${transactionIdFixture.cases[0]?.verificationKey ?? ''}">${extra}</head>` +
  `<body>${transactionIdFixture.animSvgs.join('')}</body></html>`

export const jsonResponse = (value: unknown, init: ResponseInit = {}): Response => {
  return new Response(JSON.stringify(value), { status: init.status ?? 200, headers: { 'content-type': 'application/json' } })
}

export const textResponse = (value: string, init: ResponseInit = {}): Response => {
  const responseInit: ResponseInit = { status: init.status ?? 200 }
  if (init.headers) {
    responseInit.headers = init.headers
  }
  return new Response(value, responseInit)
}

export const makeTweetResult = (id: string, handle: string, text: string, media: unknown[] = []): unknown => ({
  rest_id: id,
  core: {
    user_results: {
      result: {
        rest_id: `u${id}`,
        legacy: { screen_name: handle, name: handle.toUpperCase() }
      }
    }
  },
  legacy: {
    full_text: text,
    created_at: 'Mon Jan 01 00:00:00 +0000 2024',
    reply_count: 1,
    retweet_count: 2,
    favorite_count: 3,
    quote_count: 4,
    conversation_id_str: id,
    extended_entities: { media }
  },
  views: { count: '5' }
})

export const withQuotedTweet = (tweet: unknown, quoted: unknown): unknown => ({
  ...(tweet as Record<string, unknown>),
  quoted_status_result: { result: quoted }
})

// A repost as X serves it: a wrapper whose own text is the original cut at 140 characters
// and whose legacy block holds the real tweet.
export const asRepost = (wrapper: unknown, original: unknown): unknown => {
  const record = wrapper as { legacy: Record<string, unknown> }
  return { ...record, legacy: { ...record.legacy, retweeted_status_result: { result: original } } }
}

export const videoEntity = (): unknown => ({
  type: 'video',
  media_url_https: 'https://pbs.twimg.test/amplify/poster.jpg',
  sizes: { large: { w: 1920, h: 1080 }, small: { w: 680, h: 383 } },
  video_info: {
    duration_millis: 1322400,
    variants: [
      { content_type: 'application/x-mpegURL', url: 'https://video.twimg.test/playlist.m3u8' },
      { content_type: 'video/mp4', bitrate: 832000, url: 'https://video.twimg.test/low.mp4' },
      { content_type: 'video/mp4', bitrate: 10368000, url: 'https://video.twimg.test/high.mp4' }
    ]
  }
})

export const timelineBody = (tweets: unknown[]): unknown => ({
  data: {
    home: {
      home_timeline_urt: {
        instructions: [{
          entries: [
            ...tweets.map((tweet, index) => ({
              entryId: `tweet-${index}`,
              content: { itemContent: { tweet_results: { result: tweet } } }
            })),
            { entryId: 'cursor-bottom', content: { cursorType: 'Bottom', value: 'bottom-cursor' } },
            { entryId: 'cursor-top', content: { cursorType: 'Top', value: 'top-cursor' } }
          ]
        }]
      }
    }
  }
})

const tweetId = (tweet: unknown): string => String((tweet as { rest_id: string }).rest_id)

export const asReplyTo = (tweet: unknown, parentId: string): unknown => {
  const record = tweet as { legacy: Record<string, unknown> }
  return { ...record, legacy: { ...record.legacy, in_reply_to_status_id_str: parentId } }
}

// How X surfaces a reply from somebody you follow in the home feed: the answered tweet and
// the answer in one module, oldest first.
export const homeConversationEntry = (tweets: unknown[], moduleId = '900'): unknown => ({
  entryId: `home-conversation-${moduleId}`,
  content: {
    entryType: 'TimelineTimelineModule',
    displayType: 'VerticalConversation',
    items: tweets.map((tweet) => ({
      entryId: `home-conversation-${moduleId}-tweet-${tweetId(tweet)}`,
      item: { itemContent: { itemType: 'TimelineTweet', tweet_results: { result: tweet } } }
    }))
  }
})

export const promotedTweetEntry = (tweet: unknown): unknown => ({
  entryId: `promoted-tweet-${tweetId(tweet)}-6b760d2607570e13`,
  content: { entryType: 'TimelineTimelineItem', itemContent: { tweet_results: { result: tweet } } }
})

export const homeEntries = (entries: unknown[]): unknown[] => [{ entries }]

export const homeTweetEntry = (tweet: unknown): unknown => ({
  entryId: `tweet-${tweetId(tweet)}`,
  content: { entryType: 'TimelineTimelineItem', itemContent: { tweet_results: { result: tweet } } }
})

// Mirrors X's TweetDetail shape: the focal tweet as a tweet-* item, each reply as its own
// conversationthread-* module.
const conversationThreadEntry = (reply: unknown): unknown => {
  const id = tweetId(reply)
  return {
    entryId: `conversationthread-${id}`,
    content: {
      entryType: 'TimelineTimelineModule',
      items: [{ entryId: `conversationthread-${id}-tweet-${id}`, item: { itemContent: { tweet_results: { result: reply } } } }]
    }
  }
}

// The "Discover more" block X appends when a conversation is thin. Not a reply.
export const relatedTweetsEntry = (tweet: unknown): unknown => {
  const id = tweetId(tweet)
  return {
    entryId: `tweetdetailrelatedtweets-${id}`,
    content: {
      entryType: 'TimelineTimelineModule',
      header: { text: 'Discover more' },
      items: [{ entryId: `tweetdetailrelatedtweets-${id}-tweet-${id}`, item: { itemContent: { tweet_results: { result: tweet } } } }]
    }
  }
}

// An ad X injects inside a reply module.
export const promotedThreadEntry = (tweet: unknown): unknown => {
  const id = tweetId(tweet)
  return {
    entryId: `conversationthread-${id}`,
    content: {
      entryType: 'TimelineTimelineModule',
      items: [{ entryId: `conversationthread-${id}-promoted-tweet-${id}-abc123`, item: { itemContent: { tweet_results: { result: tweet } } } }]
    }
  }
}

// The notifications endpoint is the old REST API. Everything below mirrors that shape, with
// invented names, handles and text: a flat globalObjects map plus a timeline of entries that
// only carry ids.
export const legacyUser = (id: string, handle: string): unknown => ({
  id_str: id,
  screen_name: handle,
  name: handle.toUpperCase(),
  profile_image_url_https: `https://pbs.twimg.test/profile/${id}_normal.jpg`,
  ext_is_blue_verified: false
})

export const legacyTweet = (id: string, userId: string, text: string, extra: Record<string, unknown> = {}): unknown => ({
  id_str: id,
  user_id_str: userId,
  full_text: text,
  created_at: 'Mon Jan 01 00:00:00 +0000 2024',
  reply_count: 1,
  retweet_count: 2,
  favorite_count: 3,
  quote_count: 4,
  conversation_id_str: id,
  entities: { hashtags: [], symbols: [], urls: [], user_mentions: [] },
  ...extra
})

export const legacyPhoto = (): unknown => ({
  id_str: '90001',
  type: 'photo',
  media_url_https: 'https://pbs.twimg.test/media/notice.jpg',
  sizes: { large: { w: 1200, h: 800 }, small: { w: 680, h: 453 } },
  ext_alt_text: 'a synthetic picture'
})

export const legacyNotice = (args: { id: string; icon: string; text: string; fromUserIds: string[]; targetTweetId?: string; timestampMs?: number }): unknown => ({
  id: args.id,
  icon: { id: args.icon },
  message: { text: args.text, entities: args.fromUserIds.map((id) => ({ fromIndex: 0, toIndex: 3, ref: { user: { id } } })) },
  template: {
    aggregateUserActionsV1: {
      fromUsers: args.fromUserIds.map((id) => ({ user: { id } })),
      targetObjects: args.targetTweetId ? [{ tweet: { id: args.targetTweetId } }] : []
    }
  },
  timestampMs: args.timestampMs ?? 1704067200000
})

export const noticeEntry = (noticeId: string, args: { fromUserIds: string[]; targetTweetId?: string }): unknown => ({
  entryId: `notification-${noticeId}`,
  sortIndex: '1786111112303',
  content: {
    item: {
      clientEventInfo: { component: 'ntab' },
      content: { notification: { id: noticeId, url: { urlType: 'ExternalUrl', url: 'https://x.test/status/1' }, fromUsers: args.fromUserIds, targetTweets: args.targetTweetId ? [args.targetTweetId] : [] } }
    }
  }
})

export const mentionEntry = (tweetId: string): unknown => ({
  entryId: `tweet-${tweetId}`,
  sortIndex: '1786111112300',
  content: { item: { clientEventInfo: { component: 'ntab' }, content: { tweet: { id: tweetId, displayType: 'Tweet' } } } }
})

export const notificationsBody = (args: {
  users?: unknown[]
  tweets?: unknown[]
  notices?: unknown[]
  entries?: unknown[]
  topCursor?: string
  bottomCursor?: string
}): unknown => {
  const byId = (items: unknown[], key: string): Record<string, unknown> =>
    Object.fromEntries(items.map((item) => [String((item as Record<string, string>)[key]), item]))
  return {
    globalObjects: {
      users: byId(args.users ?? [], 'id_str'),
      tweets: byId(args.tweets ?? [], 'id_str'),
      notifications: byId(args.notices ?? [], 'id')
    },
    timeline: {
      instructions: [
        { clearCache: {} },
        {
          addEntries: {
            entries: [
              ...(args.entries ?? []),
              { entryId: 'cursor-top-0', content: { operation: { cursor: { value: args.topCursor ?? 'notif-top', cursorType: 'Top' } } } },
              { entryId: 'cursor-bottom-0', content: { operation: { cursor: { value: args.bottomCursor ?? 'notif-bottom', cursorType: 'Bottom' } } } }
            ]
          }
        }
      ]
    }
  }
}

export const tweetDetailBody = (tweet: unknown, replies: unknown[], extraEntries: unknown[] = []): unknown => ({
  data: {
    threaded_conversation_with_injections_v2: {
      instructions: [{
        entries: [
          { entryId: `tweet-${tweetId(tweet)}`, content: { entryType: 'TimelineTimelineItem', itemContent: { tweet_results: { result: tweet } } } },
          ...replies.map(conversationThreadEntry),
          ...extraEntries,
          { entryId: 'cursor-bottom-1', content: { cursorType: 'Bottom', value: 'reply-cursor' } }
        ]
      }]
    }
  }
})
