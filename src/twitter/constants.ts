export const bearerToken = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA'
export const defaultBaseUrl = 'https://x.com'
export const defaultGraphQLBase = 'https://x.com/i/api/graphql'
export const defaultUserAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'

export const fallbackQueryIds: Readonly<Record<string, string>> = {
  TweetDetail: '97JF30KziU00483E_8elBA',
  HomeTimeline: 'edseUwk9sP5Phz__9TIRnA',
  HomeLatestTimeline: 'iOEZpOdfekFsxSlPQCQtPg',
  UserByScreenName: 'xc8f1g7BYqr6VTzTbvNlGw',
  CreateTweet: 'wUgPBh9hEKhMMGlg8uDuFw',
  DeleteTweet: 'nxpZCY2K-I6QoFHAHeojFQ',
  FavoriteTweet: 'lI07N6Otwv1PhnEgXILM7A',
  UnfavoriteTweet: 'ZYKSe-w7KEslx3JhSIk5LA'
}

export const tweetTextLimit = 280

// X answers a second like on the same tweet with this code. The like the caller asked for
// is already on the tweet, so the call did its job and the code is not a failure.
export const alreadyFavoritedCode = 139

// X refuses a write with this code and the message "You have reached your daily limit for
// sending Tweets and messages". The message is wrong: the same write passes seconds later,
// far under any daily cap. The refusal is per request, so the answer is to ask again.
export const transientWriteCode = 344

// Measured against the live endpoint: a hand retry took five tries over eight seconds. The
// delays grow to cover that, and a refused write creates nothing, so a retry cannot double
// post. Four attempts in all.
export const writeRetryDelaysMs: readonly number[] = [1_000, 2_500, 6_000]

// X refuses a write with this code and the message "This request looks like it might be
// automated". It is the automation gate, and it shuts for a while rather than for a request.
export const automationWriteCode = 226

// The debug log of one live block: 24 refusals in five minutes, at about one attempt a
// second, and every one of them refused. A fast retry only feeds the gate, so this ladder
// starts above the whole hand-retry burst and doubles from there. Six attempts in all,
// over 230 seconds.
export const automationRetryDelaysMs: readonly number[] = [5_000, 15_000, 30_000, 60_000, 120_000]

// A refused write creates nothing, so the only question a code answers is how long to wait.
export const retryDelaysFor = (code: number | undefined): readonly number[] => {
  if (code === transientWriteCode) {
    return writeRetryDelaysMs
  }
  if (code === automationWriteCode) {
    return automationRetryDelaysMs
  }
  return []
}

export const tweetDetailQueryIdFallbacks = ['97JF30KziU00483E_8elBA', 'aFvUsJm2c-oDkJV75blV6g'] as const
export const targetOperations = Object.keys(fallbackQueryIds)
