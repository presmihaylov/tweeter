import type { AppMedia, AppTweet, AppVideo } from '../twitter/types.ts'

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

export type LightboxState = { key: string; url: string; label: string; width?: number; height?: number }

export type AppState = {
  tweets: Record<string, AppTweet>
  activeFeed: FeedId
  timelines: Record<FeedId, TimelineState>
  conversations: Record<string, ConversationState>
  selectedTweetId?: string
  composer: { open: boolean; replyToTweetId?: string; draft: string; error?: string; sending: boolean }
  lightbox?: LightboxState
  // Quoted tweets and replies are not in the timeline, so drilling into one pushes here
  // instead of moving the timeline cursor. The top of the stack is what the pane shows.
  detailStack: string[]
  // The detail pane has its own cursor over the parent card and the replies, so
  // Shift+↑/↓ walks them while j/k still walks the timeline behind them.
  selectedDetailId?: string
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
  detailStack: [],
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

// X answers a tweet detail with the whole thread, so the chain the tweet itself answers
// comes back beside its replies. Those ancestors belong to the parent card, not to the
// reply list; leaving them in put the same id in the cursor list twice and trapped it.
const ancestorIdsOf = (tweets: Record<string, AppTweet>, tweetId: string): Set<string> => {
  const ancestors = new Set<string>()
  let next = tweets[tweetId]?.inReplyToStatusId
  while (next !== undefined && !ancestors.has(next)) {
    ancestors.add(next)
    next = tweets[next]?.inReplyToStatusId
  }
  return ancestors
}

export const mergeConversationPage = (state: AppState, tweetId: string, replies: AppTweet[], cursor?: string): AppState => {
  const merged = mergeTweets(state, replies)
  const existing = merged.conversations[tweetId] ?? { tweetId, replyIds: [], loading: false }
  const ancestors = ancestorIdsOf(merged.tweets, tweetId)
  const replyIds = existing.replyIds.filter((id) => !ancestors.has(id))
  const seen = new Set(replyIds)
  for (const reply of replies) {
    if (!seen.has(reply.id) && !ancestors.has(reply.id)) {
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

export const beginConversationLoad = (state: AppState, tweetId: string): AppState => {
  const existing = state.conversations[tweetId] ?? { tweetId, replyIds: [] }
  return {
    ...state,
    conversations: { ...state.conversations, [tweetId]: { ...existing, loading: true, error: undefined } },
    status: 'loading replies'
  }
}

export const failConversationLoad = (state: AppState, tweetId: string, error: string): AppState => {
  const existing = state.conversations[tweetId] ?? { tweetId, replyIds: [] }
  return {
    ...state,
    conversations: { ...state.conversations, [tweetId]: { ...existing, loading: false, error } },
    status: `reply load error: ${error}`
  }
}

// The lightbox owns the whole body, so it reuses the same photo key the detail pane
// placed. Clicking the open photo closes it again.
export const toggleLightbox = (state: AppState, tweet: AppTweet | undefined, media: AppMedia | undefined): AppState => {
  if (!tweet || !media) {
    return state.lightbox ? { ...state, lightbox: undefined, status: 'closed photo' } : state
  }
  const key = `lightbox:${tweet.id}`
  if (state.lightbox?.key === key) {
    return { ...state, lightbox: undefined, status: 'closed photo' }
  }
  const size = media.width && media.height ? ` ${media.width}×${media.height}` : ''
  return {
    ...state,
    lightbox: { key, url: media.url, label: `@${tweet.author.handle} · ${media.type}${size}`, width: media.width, height: media.height },
    status: 'photo · click or Esc to close'
  }
}

// A video and an animated gif both carry a still frame at `url`, so every media kind has
// something the terminal can draw. Only the mp4 itself has to be opened outside.
export const previewOf = (tweet: AppTweet | undefined): AppMedia | undefined => tweet?.media[0]

export const videoOf = (tweet: AppTweet | undefined): AppVideo | undefined =>
  tweet?.media.find((item): item is AppVideo => item.type !== 'photo' && item.videoUrl !== undefined)

// The detail pane, the replies and every shortcut act on this tweet, not on the
// timeline cursor, so a drilled-in quote behaves like any other open tweet.
export const focusedTweetId = (state: AppState): string | undefined =>
  state.detailStack[state.detailStack.length - 1] ?? state.selectedTweetId

export const focusedTweet = (state: AppState): AppTweet | undefined => {
  const id = focusedTweetId(state)
  return id ? state.tweets[id] : undefined
}

export const replyIdsOf = (state: AppState): string[] => {
  const id = focusedTweetId(state)
  return id ? state.conversations[id]?.replyIds ?? [] : []
}

// The tweet this one answers, but only once it is in the map. Drilling into a reply
// always caches its parent first, so the pane can show it without another request.
export const parentIdOf = (state: AppState): string | undefined => {
  const id = focusedTweet(state)?.inReplyToStatusId
  return id !== undefined && state.tweets[id] ? id : undefined
}

// What the detail cursor can land on, in the order the pane draws them: the parent card
// sits above the tweet, the replies below it.
export const detailTargets = (state: AppState): string[] => {
  const parent = parentIdOf(state)
  const replies = replyIdsOf(state)
  // An id twice in this list makes the cursor jump back to the first copy, so it can
  // never leave. The parent keeps its top row and gives up any later copy.
  return parent !== undefined ? [parent, ...replies.filter((id) => id !== parent)] : replies
}

export const selectedDetail = (state: AppState): AppTweet | undefined =>
  state.selectedDetailId ? state.tweets[state.selectedDetailId] : undefined

const selectionStatus = (state: AppState, id: string): string => {
  const replies = replyIdsOf(state)
  const index = replies.indexOf(id)
  if (index < 0) {
    return `replying to @${state.tweets[id]?.author.handle ?? ''} · Shift+→ opens it`
  }
  return `reply ${index + 1}/${replies.length} · Shift+→ opens it`
}

export const selectRelativeDetail = (state: AppState, delta: number): AppState => {
  const ids = detailTargets(state)
  if (ids.length === 0) {
    return state
  }
  const current = state.selectedDetailId ? ids.indexOf(state.selectedDetailId) : -1
  // The first move enters the list; it does not step inside it. Down lands on the first
  // reply, up on the parent card when there is one, because that card is the top row.
  const entry = delta > 0 ? ids.length - replyIdsOf(state).length : (parentIdOf(state) !== undefined ? 0 : ids.length - 1)
  const base = current >= 0 ? current + delta : entry
  const next = Math.max(0, Math.min(ids.length - 1, base))
  const id = ids[next] ?? ''
  return { ...state, selectedDetailId: id, status: selectionStatus(state, id) }
}

// The tweet whose replies are still unfetched, if any. One request per tweet is enough:
// the record survives an empty page, so a tweet with no replies is never asked twice.
export const needsReplies = (state: AppState): string | undefined => {
  const id = focusedTweetId(state)
  return id !== undefined && state.tweets[id] && !state.conversations[id] ? id : undefined
}

// The plain ← hands the arrows back to the feed without leaving the open tweet.
export const clearDetailSelection = (state: AppState): AppState =>
  state.selectedDetailId === undefined ? state : { ...state, selectedDetailId: undefined, status: 'back to the feed' }

// The plain right arrow jumps straight to the top of the reply list, whatever the
// cursor was on before.
export const selectFirstReply = (state: AppState): AppState => {
  const id = replyIdsOf(state)[0]
  if (id === undefined) {
    return state
  }
  return { ...state, selectedDetailId: id, status: selectionStatus(state, id) }
}

// Shift+→ opens whatever the reader picked last: the parent card or a reply when one is
// selected, otherwise the quoted tweet.
export const enterSelection = (state: AppState, targetId?: string): AppState => {
  const picked = targetId !== undefined ? state.tweets[targetId] : selectedDetail(state)
  const target = picked ?? focusedTweet(state)?.quotedTweet
  if (!target) {
    return state
  }
  // A quote nested two levels deep never reached the tweet map, so store it now.
  const merged = mergeTweets(state, [target])
  return {
    ...merged,
    detailStack: [...state.detailStack, target.id],
    selectedDetailId: undefined,
    lightbox: undefined,
    status: `opened ${picked ? 'tweet' : 'quote'} @${target.author.handle} · Shift+← back`
  }
}

export const leaveSelection = (state: AppState): AppState => {
  if (state.detailStack.length === 0) {
    return state
  }
  const detailStack = state.detailStack.slice(0, -1)
  const back = focusedTweet({ ...state, detailStack })
  return {
    ...state,
    detailStack,
    selectedDetailId: undefined,
    lightbox: undefined,
    status: back ? `back to @${back.author.handle}` : 'back'
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
  // A stale "opened quote" line would otherwise still claim the quote is open.
  const status = state.detailStack.length > 0 ? 'left quote' : state.status
  return { ...state, selectedTweetId: timeline.tweetIds[nextIndex], lightbox: undefined, detailStack: [], selectedDetailId: undefined, status }
}
