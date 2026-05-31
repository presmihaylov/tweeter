export const bearerToken = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA'
export const defaultBaseUrl = 'https://x.com'
export const defaultGraphQLBase = 'https://x.com/i/api/graphql'
export const defaultUserAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

export const fallbackQueryIds: Readonly<Record<string, string>> = {
  CreateTweet: 'a1p9RWpkYKBjWv_I3WzS-A',
  TweetDetail: '97JF30KziU00483E_8elBA',
  HomeTimeline: 'edseUwk9sP5Phz__9TIRnA',
  HomeLatestTimeline: 'iOEZpOdfekFsxSlPQCQtPg',
  UserByScreenName: 'xc8f1g7BYqr6VTzTbvNlGw'
}

export const createTweetQueryId = 'a1p9RWpkYKBjWv_I3WzS-A'
export const tweetDetailQueryIdFallbacks = ['97JF30KziU00483E_8elBA', 'aFvUsJm2c-oDkJV75blV6g'] as const
export const targetOperations = Object.keys(fallbackQueryIds)
