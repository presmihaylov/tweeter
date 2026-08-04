import type { AppTweet } from '../types.ts'
import { getBool, getInt, getMap, getSlice, getStr, isRecord } from '../../utils/guards.ts'
import { extractMedia } from './media.ts'
import { extractTweetText } from './text.ts'

export const unwrapTweetResult = (result: unknown): unknown => {
  const tweet = getMap(result, 'tweet')
  return tweet ?? result
}

export const mapTweetResult = (result: unknown, quoteDepth = 1): AppTweet | undefined => {
  const unwrapped = unwrapTweetResult(result)
  const userResult = getMap(getMap(getMap(unwrapped, 'core'), 'user_results'), 'result')
  const userLegacy = getMap(userResult, 'legacy')
  const userCore = getMap(userResult, 'core')
  const handle = getStr(userLegacy, 'screen_name') || getStr(userCore, 'screen_name')
  const name = getStr(userLegacy, 'name') || getStr(userCore, 'name') || handle
  const id = getStr(unwrapped, 'rest_id')
  const text = extractTweetText(unwrapped)
  if (id === '' || handle === '' || text === '') {
    return undefined
  }
  const legacy = getMap(unwrapped, 'legacy')
  // A repost carries nothing of its own: its text is the original cut at 140 characters,
  // it has no media and no replies. Only the original is worth showing.
  const repost = getMap(getMap(legacy, 'retweeted_status_result'), 'result')
  if (repost) {
    const original = mapTweetResult(repost, quoteDepth)
    return original ? { ...original, repostedBy: { handle, name } } : undefined
  }
  const views = getMap(unwrapped, 'views')
  const quotedResult = getMap(getMap(unwrapped, 'quoted_status_result'), 'result')
  const quotedTweet = quoteDepth > 0 && quotedResult ? mapTweetResult(quotedResult, quoteDepth - 1) : undefined
  const authorId = getStr(userResult, 'rest_id')
  const avatarUrl = getStr(getMap(userResult, 'avatar'), 'image_url') || getStr(userLegacy, 'profile_image_url_https')
  return stripUndefined({
    id,
    text,
    author: stripUndefined({
      id: authorId || undefined,
      handle,
      name,
      avatarUrl: upsizeAvatar(avatarUrl) || undefined,
      verified: getBool(userResult, 'is_blue_verified') || getBool(userLegacy, 'verified') || undefined
    }),
    createdAt: getStr(legacy, 'created_at') || undefined,
    media: extractMedia(unwrapped),
    metrics: stripUndefined({
      replies: getInt(legacy, 'reply_count') || undefined,
      reposts: getInt(legacy, 'retweet_count') || undefined,
      likes: getInt(legacy, 'favorite_count') || undefined,
      quotes: getInt(legacy, 'quote_count') || undefined,
      bookmarks: getInt(legacy, 'bookmark_count') || undefined,
      views: getInt(views, 'count') || undefined
    }),
    conversationId: getStr(legacy, 'conversation_id_str') || undefined,
    inReplyToStatusId: getStr(legacy, 'in_reply_to_status_id_str') || undefined,
    quotedTweetId: quotedTweet?.id,
    quotedTweet,
    favorited: getBool(legacy, 'favorited') || undefined,
    retweeted: getBool(legacy, 'retweeted') || undefined
  })
}

// X serves avatars at 48px under the _normal suffix; the 400px variant survives a TUI upscale.
export const upsizeAvatar = (url: string): string => url.replace(/_normal\.(jpg|jpeg|png|gif|webp)$/i, '_400x400.$1')

export const collectTweetResultsFromEntry = (entry: unknown): unknown[] => {
  const results: unknown[] = []
  const content = getMap(entry, 'content')
  if (!content) {
    return results
  }
  const push = (candidate: unknown): void => {
    const unwrapped = unwrapTweetResult(candidate)
    if (isRecord(unwrapped) && getStr(unwrapped, 'rest_id') !== '') {
      results.push(unwrapped)
    }
  }
  push(getMap(getMap(getMap(content, 'itemContent'), 'tweet_results'), 'result'))
  push(getMap(getMap(getMap(getMap(content, 'item'), 'itemContent'), 'tweet_results'), 'result'))
  for (const item of getSlice(content, 'items') ?? []) {
    push(getMap(getMap(getMap(getMap(item, 'item'), 'itemContent'), 'tweet_results'), 'result'))
    push(getMap(getMap(getMap(item, 'itemContent'), 'tweet_results'), 'result'))
    push(getMap(getMap(getMap(getMap(item, 'content'), 'itemContent'), 'tweet_results'), 'result'))
  }
  return results
}

export const parseTweetsFromInstructions = (instructions: unknown[], quoteDepth = 1): AppTweet[] => {
  const seen = new Set<string>()
  const tweets: AppTweet[] = []
  for (const instruction of instructions) {
    for (const entry of getSlice(instruction, 'entries') ?? []) {
      for (const result of collectTweetResultsFromEntry(entry)) {
        const tweet = mapTweetResult(result, quoteDepth)
        if (!tweet || seen.has(tweet.id)) {
          continue
        }
        seen.add(tweet.id)
        tweets.push(tweet)
      }
    }
  }
  return tweets
}

export const getHomeInstructions = (result: unknown): unknown[] => {
  const data = getMap(result, 'data')
  const direct = getSlice(getMap(data, 'home_timeline_urt'), 'instructions')
  if (direct) {
    return direct
  }
  const nested = getSlice(getMap(getMap(data, 'home'), 'home_timeline_urt'), 'instructions')
  if (nested) {
    return nested
  }
  return getTimelineInstructions(result)
}

export const getTweetDetailInstructions = (result: unknown): unknown[] => {
  const data = getMap(result, 'data')
  const tweetResultInstructions = getSlice(getMap(getMap(getMap(data, 'tweetResult'), 'result'), 'timeline'), 'instructions')
  if (tweetResultInstructions) {
    return tweetResultInstructions
  }
  return getSlice(getMap(data, 'threaded_conversation_with_injections_v2'), 'instructions') ?? []
}

const getTimelineInstructions = (result: unknown): unknown[] => {
  const data = getMap(result, 'data')
  const timeline = getMap(data, 'timeline') ?? getMap(data, 'bookmark_timeline') ?? getMap(data, 'user')
  return getSlice(getMap(timeline, 'timeline'), 'instructions') ?? getSlice(timeline, 'instructions') ?? []
}

const stripUndefined = <T extends Record<string, unknown>>(value: T): T => {
  return Object.fromEntries(Object.entries(value).filter((entry) => entry[1] !== undefined)) as T
}
