import type { Fetcher } from '../utils/fetcher.ts'
import type { DebugLogger } from '../utils/debugLog.ts'

export type AuthStatus =
  | { ok: true; username?: string; userId?: string; name?: string; source: string }
  | { ok: false; error: string; status?: number }

export type AppMedia =
  | { type: 'photo'; url: string; previewUrl?: string; width?: number; height?: number; altText?: string }
  | { type: 'video' | 'animated_gif'; url: string; videoUrl?: string; previewUrl?: string; width?: number; height?: number; durationMs?: number; altText?: string }

export type AppVideo = Extract<AppMedia, { type: 'video' | 'animated_gif' }>

// One piece of an article body, in the order x.com lays it out. The plain text loses the
// images and can lag behind what the author last published, so the blocks are the copy
// that reaches the screen.
export type ArticleBlock =
  | { kind: 'text'; text: string; style?: 'header' | 'bullet' }
  | { kind: 'image'; media: AppMedia; caption?: string }

export type ArticleBody = { title: string; blocks?: ArticleBlock[] }

export type AppTweet = {
  id: string
  text: string
  author: { id?: string; handle: string; name: string; avatarUrl?: string; verified?: boolean }
  createdAt?: string
  media: AppMedia[]
  metrics: { replies?: number; reposts?: number; likes?: number; quotes?: number; bookmarks?: number; views?: number }
  conversationId?: string
  inReplyToStatusId?: string
  quotedTweetId?: string
  quotedTweet?: AppTweet
  favorited?: boolean
  bookmarked?: boolean
  retweeted?: boolean
  // Set when the timeline carried this tweet because somebody reposted it. Every other
  // field belongs to the original tweet, the way x.com shows a repost.
  repostedBy?: { handle: string; name: string }
  // Set when X served a whole article behind the tweet. The text then holds the title and
  // the body, which runs to thousands of characters instead of a post.
  article?: ArticleBody
}

export type TimelinePage = {
  tweets: AppTweet[]
  topCursor?: string
  bottomCursor?: string
}

// A profile timeline, plus the account it belongs to. The two arrive in one answer.
export type UserTimelinePage = TimelinePage & { profile?: AppProfile }

// The account behind the cookies, as its profile page reports it. X gives the follower
// count for right now and keeps no history of it, so the app samples it day by day.
export type AppProfile = {
  id: string
  handle: string
  name: string
  followers: number
  following: number
  posts: number
}

export type TweetBundle = {
  tweet: AppTweet
  related: AppTweet[]
}

// What the icon beside a notification says happened. X names a few dozen icons; these are
// the ones the TUI draws, and anything else falls back to a plain dot.
export type NoticeIcon = 'like' | 'repost' | 'follow' | 'bell' | 'other'

// Some notices stand for a list of posts rather than for one post of yours: the bell line
// stands for what the accounts you subscribed to published, and an aggregated like stands for
// the posts that person liked. X names the path that holds them and the title it draws above.
export type NoticeList = {
  path: string
  title: string
}

// One aggregated line off the notifications tab, such as "Ann and 2 others liked your post".
// X writes the whole sentence, names and all, so the TUI shows it as it stands.
export type AppNotice = {
  icon: NoticeIcon
  text: string
  avatarUrl?: string
  createdAt?: string
  list?: NoticeList
}

// A row on the notifications tab is either a tweet card, when somebody mentioned or answered
// this account, or a notice line. A notice that names a tweet carries its id, so the detail
// pane and the like, bookmark and reply keys all keep working on the row under the cursor.
// A row opened out of a notice names that notice, which is how it is drawn under it and taken
// away again.
export type NotificationRow = {
  key: string
  tweetId?: string
  notice?: AppNotice
  parentKey?: string
}

export type NotificationPage = {
  rows: NotificationRow[]
  tweets: AppTweet[]
  topCursor?: string
  bottomCursor?: string
}

// The unread badges x.com draws on its own tabs.
export type BadgeCounts = { notifications: number; messages: number }

export type ConversationPage = {
  tweetId: string
  replies: AppTweet[]
  cursor?: string
  // The same page also answers with the tweet the reader opened. The home timeline sends an
  // article as its title alone, so this copy is the only one that carries the body.
  focal?: AppTweet
}

export type PostResult =
  | { ok: true; tweetId: string }
  | { ok: false; error: string; code?: number; status?: number }

export type DeleteResult =
  | { ok: true }
  | { ok: false; error: string; code?: number; status?: number }

export type LikeResult =
  | { ok: true }
  | { ok: false; error: string; code?: number; status?: number }

export type TwitterClientOptions = {
  authToken: string
  ct0: string
  cookieHeader?: string
  baseUrl?: string
  graphQLBase?: string
  userAgent?: string
  timeoutMs?: number
  fetch?: Fetcher
  queryIdPath?: string
  debugLogger?: DebugLogger
  // Injected so a test can walk the write retry backoff without waiting for it.
  sleep?: (ms: number) => Promise<void>
}

// A write that X refused with a transient code is asked again. The caller hears about each
// wait, so the screen can say why the reply has not landed yet.
export type WriteRetryNotice = { attempt: number; attempts: number; delayMs: number; code: number }
