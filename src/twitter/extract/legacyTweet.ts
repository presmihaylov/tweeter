import type { AppTweet } from '../types.ts'
import { getBool, getFlag, getInt, getMap, getStr } from '../../utils/guards.ts'
import { extractMedia } from './media.ts'
import { upsizeAvatar } from './tweet.ts'

// The notifications endpoint is the old REST API, not GraphQL. It answers with a flat
// globalObjects map and the pre-2021 tweet shape: full_text in place of a note_tweet, a
// user_id_str in place of a nested user result, and counts on the tweet itself. mapTweetResult
// cannot read any of that, so this maps the older shape onto the same AppTweet.
export const mapLegacyTweet = (raw: unknown, users: unknown): AppTweet | undefined => {
  const id = getStr(raw, 'id_str')
  const text = getStr(raw, 'full_text') || getStr(raw, 'text')
  const authorId = getStr(raw, 'user_id_str')
  const user = getMap(users, authorId)
  const handle = getStr(user, 'screen_name')
  if (id === '' || text === '' || handle === '') {
    return undefined
  }
  return stripUndefined({
    id,
    text,
    author: stripUndefined({
      id: authorId || undefined,
      handle,
      name: getStr(user, 'name') || handle,
      avatarUrl: upsizeAvatar(getStr(user, 'profile_image_url_https')) || undefined,
      verified: getBool(user, 'ext_is_blue_verified') || getBool(user, 'verified') || undefined,
      // The old shape keeps the follow flags on the user itself.
      following: getFlag(user, 'following'),
      followedBy: getFlag(user, 'followed_by')
    }),
    createdAt: getStr(raw, 'created_at') || undefined,
    // extractMedia reads entities under a legacy key, which is exactly what this tweet is.
    media: extractMedia({ legacy: raw }),
    metrics: stripUndefined({
      replies: getInt(raw, 'reply_count') || undefined,
      reposts: getInt(raw, 'retweet_count') || undefined,
      likes: getInt(raw, 'favorite_count') || undefined,
      quotes: getInt(raw, 'quote_count') || undefined,
      bookmarks: getInt(raw, 'bookmark_count') || undefined
    }),
    conversationId: getStr(raw, 'conversation_id_str') || undefined,
    inReplyToStatusId: getStr(raw, 'in_reply_to_status_id_str') || undefined,
    quotedTweetId: getStr(raw, 'quoted_status_id_str') || undefined,
    favorited: getBool(raw, 'favorited') || undefined,
    bookmarked: getBool(raw, 'bookmarked') || undefined,
    retweeted: getBool(raw, 'retweeted') || undefined
  })
}

// globalObjects holds every tweet the page mentions in one map, keyed by id, and the entries
// only carry those ids. The quoted tweet of a mention is in the same map, so a second pass
// hangs it on the tweet that quotes it.
export const parseLegacyTweets = (globalObjects: unknown): AppTweet[] => {
  const rawTweets = getMap(globalObjects, 'tweets')
  const users = getMap(globalObjects, 'users')
  if (!rawTweets) {
    return []
  }
  const byId = new Map<string, AppTweet>()
  for (const raw of Object.values(rawTweets)) {
    const tweet = mapLegacyTweet(raw, users)
    if (tweet) {
      byId.set(tweet.id, tweet)
    }
  }
  const tweets: AppTweet[] = []
  for (const tweet of byId.values()) {
    const quoted = tweet.quotedTweetId ? byId.get(tweet.quotedTweetId) : undefined
    tweets.push(quoted ? { ...tweet, quotedTweet: quoted } : tweet)
  }
  return tweets
}

const stripUndefined = <T extends Record<string, unknown>>(value: T): T => {
  return Object.fromEntries(Object.entries(value).filter((entry) => entry[1] !== undefined)) as T
}
