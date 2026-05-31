import type { AppTweet } from '../twitter/types.ts'

export type FeedId = 'following' | 'forYou'

export type TimelineState = {
  id: FeedId
  tweetIds: string[]
  topCursor?: string
  bottomCursor?: string
  loading: boolean
  error?: string
}

export type ConversationState = {
  tweetId: string
  replyIds: string[]
  cursor?: string
  loading: boolean
  error?: string
}

export type AppState = {
  tweets: Record<string, AppTweet>
  activeFeed: FeedId
  timelines: Record<FeedId, TimelineState>
  conversations: Record<string, ConversationState>
  selectedTweetId?: string
  composer: { open: boolean; replyToTweetId?: string; draft: string; error?: string; sending: boolean }
  status: string
}

export const initialAppState = (): AppState => ({
  tweets: {},
  activeFeed: 'following',
  timelines: {
    following: { id: 'following', tweetIds: [], loading: false },
    forYou: { id: 'forYou', tweetIds: [], loading: false }
  },
  conversations: {},
  composer: { open: false, draft: '', sending: false },
  status: 'starting'
})

export const mergeTweets = (state: AppState, tweets: AppTweet[]): AppState => {
  const nextTweets = { ...state.tweets }
  for (const tweet of tweets) {
    nextTweets[tweet.id] = tweet
    if (tweet.quotedTweet) {
      nextTweets[tweet.quotedTweet.id] = tweet.quotedTweet
    }
  }
  return { ...state, tweets: nextTweets }
}

export const mergeTimelinePage = (state: AppState, feed: FeedId, tweets: AppTweet[], cursors: { topCursor?: string; bottomCursor?: string }): AppState => {
  const merged = mergeTweets(state, tweets)
  const existing = merged.timelines[feed]
  const seen = new Set(existing.tweetIds)
  const tweetIds = [...existing.tweetIds]
  for (const tweet of tweets) {
    if (!seen.has(tweet.id)) {
      seen.add(tweet.id)
      tweetIds.push(tweet.id)
    }
  }
  const timeline: TimelineState = {
    ...existing,
    tweetIds,
    loading: false,
    error: undefined,
    topCursor: cursors.topCursor ?? existing.topCursor,
    bottomCursor: cursors.bottomCursor ?? existing.bottomCursor
  }
  return {
    ...merged,
    timelines: { ...merged.timelines, [feed]: timeline },
    selectedTweetId: merged.selectedTweetId ?? tweetIds[0]
  }
}

export const mergeConversationPage = (state: AppState, tweetId: string, replies: AppTweet[], cursor?: string): AppState => {
  const merged = mergeTweets(state, replies)
  const existing = merged.conversations[tweetId] ?? { tweetId, replyIds: [], loading: false }
  const seen = new Set(existing.replyIds)
  const replyIds = [...existing.replyIds]
  for (const reply of replies) {
    if (!seen.has(reply.id)) {
      seen.add(reply.id)
      replyIds.push(reply.id)
    }
  }
  return {
    ...merged,
    conversations: {
      ...merged.conversations,
      [tweetId]: { ...existing, replyIds, cursor, loading: false, error: undefined }
    }
  }
}

export const selectRelativeTweet = (state: AppState, delta: number): AppState => {
  const timeline = state.timelines[state.activeFeed]
  if (timeline.tweetIds.length === 0) {
    return state
  }
  const currentIndex = state.selectedTweetId ? timeline.tweetIds.indexOf(state.selectedTweetId) : 0
  const base = currentIndex >= 0 ? currentIndex : 0
  const nextIndex = Math.max(0, Math.min(timeline.tweetIds.length - 1, base + delta))
  return { ...state, selectedTweetId: timeline.tweetIds[nextIndex] }
}
