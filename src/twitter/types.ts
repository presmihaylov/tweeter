import type { Fetcher } from '../utils/fetcher.ts'
import type { DebugLogger } from '../utils/debugLog.ts'

export type AuthStatus =
  | { ok: true; username: string; userId?: string; name?: string; source: string }
  | { ok: false; error: string; status?: number }

export type AppMedia =
  | { type: 'photo'; url: string; previewUrl?: string; width?: number; height?: number; altText?: string }
  | { type: 'video' | 'animated_gif'; url: string; videoUrl?: string; previewUrl?: string; width?: number; height?: number; durationMs?: number; altText?: string }

export type AppTweet = {
  id: string
  text: string
  author: { id?: string; handle: string; name: string }
  createdAt?: string
  media: AppMedia[]
  metrics: { replies?: number; reposts?: number; likes?: number; quotes?: number; bookmarks?: number; views?: number }
  conversationId?: string
  inReplyToStatusId?: string
  quotedTweetId?: string
  quotedTweet?: AppTweet
  favorited?: boolean
  retweeted?: boolean
}

export type TimelinePage = {
  tweets: AppTweet[]
  topCursor?: string
  bottomCursor?: string
}

export type TweetBundle = {
  tweet: AppTweet
  related: AppTweet[]
}

export type ConversationPage = {
  tweetId: string
  replies: AppTweet[]
  cursor?: string
}

export type PostResult =
  | { ok: true; tweetId: string }
  | { ok: false; error: string; code?: number; status?: number }

export type TwitterClientOptions = {
  authToken: string
  ct0: string
  baseUrl?: string
  graphQLBase?: string
  userAgent?: string
  timeoutMs?: number
  fetch?: Fetcher
  queryIdPath?: string
  debugLogger?: DebugLogger
}
