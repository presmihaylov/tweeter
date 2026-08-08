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
  UnfavoriteTweet: 'ZYKSe-w7KEslx3JhSIk5LA',
  CreateBookmark: 'aoDbu3RHznuiSkQ9aNM67Q',
  DeleteBookmark: 'Wlmlj2-xzyS1GN3a6cj-mQ',
  SearchTimeline: 'PusO6nN_nUSAsfJktZJd9w',
  accountOverviewDailyQuery: '_P1caq0YB4SVuEtFLPDMfQ'
}

// The one read the stats page makes. x.com draws its own analytics page from a chunk it
// loads only when you open it, so the id is in neither the main nor the vendor bundle:
// discovery has to build the chunk URL out of the shell's own chunk map.
export const analyticsOperation = 'accountOverviewDailyQuery'

export const lazyChunkOperations: Readonly<Record<string, string>> = {
  [analyticsOperation]: 'bundle.AccountAnalytics'
}

export const tweetTextLimit = 280

// The notifications tab is the old REST API, and it answers a bare request with a thinner
// page: no extended text, no media sizes, no reply counts. These are the toggles x.com itself
// sends, minus the ones for parts this app does not draw.
export const notificationParams: Readonly<Record<string, string>> = {
  include_profile_interstitial_type: '1',
  include_blocking: '1',
  include_followed_by: '1',
  include_can_dm: '1',
  skip_status: '1',
  cards_platform: 'Web-12',
  include_cards: '1',
  include_ext_alt_text: 'true',
  include_quote_count: 'true',
  include_reply_count: '1',
  tweet_mode: 'extended',
  include_entities: 'true',
  include_user_entities: 'true',
  include_ext_media_color: 'true',
  include_ext_media_availability: 'true',
  send_error_codes: 'true',
  simple_quoted_tweet: 'true',
  ext: 'mediaStats,highlightedLabel',
  include_ext_edit_control: 'true'
}

// What x.com sends with a follow or an unfollow. The switches only decide how much of the
// account comes back in the answer; the user_id beside them is what the call acts on.
export const friendshipParams: Readonly<Record<string, string>> = {
  include_profile_interstitial_type: '1',
  include_blocking: '1',
  include_blocked_by: '1',
  include_followed_by: '1',
  include_want_retweets: '1',
  include_mute_edge: '1',
  include_can_dm: '1',
  include_can_media_tag: '1',
  include_ext_is_blue_verified: '1',
  include_ext_verified_type: '1',
  include_ext_profile_image_shape: '1',
  skip_status: '1'
}

// What x.com sends with the typeahead read behind its own @ menu. src names where the text
// was typed, and the result type keeps the answer to accounts: the same endpoint also serves
// topics, events and hashtags, which cannot be tagged in a tweet.
export const typeaheadParams: Readonly<Record<string, string>> = {
  include_ext_is_blue_verified: '1',
  include_ext_verified_type: '1',
  include_ext_profile_image_shape: '1',
  src: 'compose',
  result_type: 'users'
}

// X answers a second like on the same tweet with this code. The like the caller asked for
// is already on the tweet, so the call did its job and the code is not a failure. A second
// bookmark answers with the same code, and with the same "already favorited" wording.
export const alreadyFavoritedCode = 139

// The other direction: X refuses to remove a bookmark that the account does not hold, and
// says the tweet "was not found in actor's favorites". The tweet is already off the list.
export const notBookmarkedCode = 144

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
// The read the stats page makes was added after the last known-good id set, so it carries
// no fallback: discovery reads its id off the x.com bundle like every other one.
export const discoveredOperations = ['UserTweetsAndReplies']

export const targetOperations = [...Object.keys(fallbackQueryIds), ...discoveredOperations]
