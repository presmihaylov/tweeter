import type { AppMedia, AppTweet, AppVideo, NotificationPage, NotificationRow } from '../twitter/types.ts'

export type FeedId = 'following' | 'forYou'

// Notifications are a third tab but not a third feed: they hold rows, and a row is either a
// tweet or an aggregated line. Keeping the two apart lets the type checker prove that every
// place which needs a timeline still names one of the two tweet feeds.
export type TabId = FeedId | 'notifications'

// What x.com calls "Sort by" on the Following tab. Recent is what X gives a client that
// asks for nothing, so it stays the default here too.
export type FeedSort = 'recent' | 'popular'

export type TimelineState = {
  id: FeedId
  tweetIds: string[]
  topCursor?: string
  bottomCursor?: string
  loading: boolean
  error?: string
}

export type NotificationsState = {
  rows: NotificationRow[]
  topCursor?: string
  bottomCursor?: string
  loading: boolean
  error?: string
  // What x.com puts on its own tab as a blue dot. This app only reads it, so it clears when
  // x.com clears it and not before.
  unread: number
}

export type ConversationState = {
  tweetId: string
  replyIds: string[]
  cursor?: string
  loading: boolean
  error?: string
}

export type LightboxState = { key: string; url: string; label: string; width?: number; height?: number }

// Both writes are a draft against the tweet the reader is on, so one drawer serves both.
// A reply answers that tweet; a quote reposts it with the draft on top.
export type ComposerMode = 'reply' | 'quote'

// Where the next character lands, counted in characters from the start of the draft. The
// drawer is a text field, so a keystroke acts here and not at the end of the draft.
export type CaretMove = 'left' | 'right' | 'start' | 'end' | 'wordLeft' | 'wordRight'

export type AppState = {
  tweets: Record<string, AppTweet>
  activeTab: TabId
  feedSort: FeedSort
  timelines: Record<FeedId, TimelineState>
  notifications: NotificationsState
  conversations: Record<string, ConversationState>
  selectedTweetId?: string
  // The notifications tab walks rows, not tweets, so it keeps its own cursor. A row names
  // the tweet it is about, and focusedTweetId reads it from here while that tab is up.
  selectedRowKey?: string
  composer: { open: boolean; mode: ComposerMode; targetTweetId?: string; draft: string; caret: number; error?: string; sending: boolean }
  lightbox?: LightboxState
  // Quoted tweets and replies are not in the timeline, so drilling into one pushes here
  // instead of moving the timeline cursor. The top of the stack is what the pane shows.
  detailStack: string[]
  // The detail pane has its own cursor over the parent card and the replies, so
  // Shift+↑/↓ walks them while j/k still walks the timeline behind them.
  selectedDetailId?: string
  // An article runs to thousands of characters, so the text itself is a stop for the
  // arrows: ↑/↓ scroll it here instead of moving a cursor. Never true together with
  // selectedDetailId, because both would answer the same key.
  textFocused: boolean
  // The key list outgrew the header row, so it lives in a popup that ? opens and closes.
  helpOpen: boolean
  // A short terminal cannot hold every key at once, so the popup scrolls. The screen owns
  // how far it can go, because only the screen knows how many rows it has.
  helpScroll: number
  status: string
}

export const initialAppState = (): AppState => ({
  tweets: {},
  activeTab: 'following',
  feedSort: 'recent',
  timelines: {
    following: { id: 'following', tweetIds: [], loading: false },
    forYou: { id: 'forYou', tweetIds: [], loading: false }
  },
  notifications: { rows: [], loading: false, unread: 0 },
  conversations: {},
  composer: { open: false, mode: 'reply', draft: '', caret: 0, sending: false },
  detailStack: [],
  textFocused: false,
  helpOpen: false,
  helpScroll: 0,
  status: 'starting'
})

export const toggleHelp = (state: AppState): AppState => ({ ...state, helpOpen: !state.helpOpen, helpScroll: 0 })

export const closeHelp = (state: AppState): AppState =>
  state.helpOpen ? { ...state, helpOpen: false, helpScroll: 0 } : state

export const scrollHelp = (state: AppState, delta: number, max: number): AppState => {
  const helpScroll = Math.max(0, Math.min(max, state.helpScroll + delta))
  return helpScroll === state.helpScroll ? state : { ...state, helpScroll }
}

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

const withLike = (tweet: AppTweet, liked: boolean): AppTweet => ({
  ...tweet,
  favorited: liked,
  metrics: { ...tweet.metrics, likes: Math.max(0, (tweet.metrics.likes ?? 0) + (liked ? 1 : -1)) }
})

// The card moves before X answers, so the reader sees the like land at once. The same tweet
// can sit in the map on its own and again inside the tweet that quotes it, so both copies
// move or the two cards would disagree about the count.
export const applyLike = (state: AppState, tweetId: string, liked: boolean): AppState => {
  const target = state.tweets[tweetId]
  if (!target || (target.favorited ?? false) === liked) {
    return state
  }
  const tweets: Record<string, AppTweet> = {}
  for (const [id, tweet] of Object.entries(state.tweets)) {
    const base = id === tweetId ? withLike(tweet, liked) : tweet
    tweets[id] = tweet.quotedTweet?.id === tweetId ? { ...base, quotedTweet: withLike(tweet.quotedTweet, liked) } : base
  }
  return { ...state, tweets }
}

const withBookmark = (tweet: AppTweet, bookmarked: boolean): AppTweet => ({
  ...tweet,
  bookmarked,
  metrics: { ...tweet.metrics, bookmarks: Math.max(0, (tweet.metrics.bookmarks ?? 0) + (bookmarked ? 1 : -1)) }
})

// Same two copies as applyLike: the tweet on its own, and the tweet inside the one that
// quotes it.
export const applyBookmark = (state: AppState, tweetId: string, bookmarked: boolean): AppState => {
  const target = state.tweets[tweetId]
  if (!target || (target.bookmarked ?? false) === bookmarked) {
    return state
  }
  const tweets: Record<string, AppTweet> = {}
  for (const [id, tweet] of Object.entries(state.tweets)) {
    const base = id === tweetId ? withBookmark(tweet, bookmarked) : tweet
    tweets[id] = tweet.quotedTweet?.id === tweetId ? { ...base, quotedTweet: withBookmark(tweet.quotedTweet, bookmarked) } : base
  }
  return { ...state, tweets }
}

// Where a fetched page belongs. X hands back two cursors per page and they point opposite
// ways: the top one asks for what arrived since, the bottom one asks for the next page down.
export type PagePlacement = 'top' | 'bottom'

export const mergeTimelinePage = (state: AppState, feed: FeedId, tweets: AppTweet[], cursors: { topCursor?: string; bottomCursor?: string }, placement: PagePlacement = 'bottom'): AppState => {
  const merged = mergeTweets(state, tweets)
  const existing = merged.timelines[feed]
  const seen = new Set(existing.tweetIds)
  const fresh: string[] = []
  for (const tweet of tweets) {
    if (!seen.has(tweet.id)) {
      seen.add(tweet.id)
      fresh.push(tweet.id)
    }
  }
  const tweetIds = placement === 'top' ? [...fresh, ...existing.tweetIds] : [...existing.tweetIds, ...fresh]
  // A page down that holds nothing new is the end of the feed. Keeping a cursor there would
  // let the automatic older-page fetch ask for that same empty page forever.
  const nextBottom = fresh.length === 0 ? undefined : cursors.bottomCursor ?? existing.bottomCursor
  const timeline: TimelineState = {
    ...existing,
    tweetIds,
    loading: false,
    error: undefined,
    // Each page carries both cursors, but only the one that matches the direction of the
    // fetch is current. A page pulled from the bottom names its own top, not the newest
    // tweet, so letting it move the top cursor would make the next refresh skip backwards.
    topCursor: placement === 'top' ? cursors.topCursor ?? existing.topCursor : existing.topCursor ?? cursors.topCursor,
    bottomCursor: placement === 'bottom' ? nextBottom : existing.bottomCursor ?? cursors.bottomCursor
  }
  return {
    ...merged,
    timelines: { ...merged.timelines, [feed]: timeline },
    selectedTweetId: merged.selectedTweetId ?? tweetIds[0]
  }
}

// The same two cursors as a timeline page, and the same rule about an empty page down. A row
// is keyed by its entry id, so a page that repeats a row drops the repeat.
export const mergeNotificationsPage = (state: AppState, page: NotificationPage, placement: PagePlacement = 'bottom'): AppState => {
  const merged = mergeTweets(state, page.tweets)
  const existing = merged.notifications
  const seen = new Set(existing.rows.map((row) => row.key))
  const fresh = page.rows.filter((row) => !seen.has(row.key))
  const rows = placement === 'top' ? [...fresh, ...existing.rows] : [...existing.rows, ...fresh]
  const bottomCursor = fresh.length === 0 ? undefined : page.bottomCursor ?? existing.bottomCursor
  return {
    ...merged,
    notifications: {
      ...existing,
      rows,
      loading: false,
      error: undefined,
      topCursor: placement === 'top' ? page.topCursor ?? existing.topCursor : existing.topCursor ?? page.topCursor,
      bottomCursor: placement === 'bottom' ? bottomCursor : existing.bottomCursor ?? page.bottomCursor
    },
    selectedRowKey: merged.selectedRowKey ?? rows[0]?.key
  }
}

export const selectedRow = (state: AppState): NotificationRow | undefined =>
  state.notifications.rows.find((row) => row.key === state.selectedRowKey)

export const selectRelativeRow = (state: AppState, delta: number): AppState => {
  const rows = state.notifications.rows
  if (rows.length === 0) {
    return state
  }
  const currentIndex = state.selectedRowKey ? rows.findIndex((row) => row.key === state.selectedRowKey) : 0
  const base = currentIndex >= 0 ? currentIndex : 0
  const nextIndex = Math.max(0, Math.min(rows.length - 1, base + delta))
  const status = state.detailStack.length > 0 ? 'left quote' : state.status
  return { ...state, selectedRowKey: rows[nextIndex]?.key, lightbox: undefined, detailStack: [], selectedDetailId: undefined, textFocused: false, status }
}

// A sort change makes the loaded page and its cursor stale: the cursor indexes the old
// order, so paging on with it would interleave two sorts. Empty the feed and let the
// caller load page one again.
export const setFeedSort = (state: AppState, sort: FeedSort): AppState => {
  const cleared: TimelineState = { id: 'following', tweetIds: [], loading: false }
  return {
    ...state,
    feedSort: sort,
    timelines: { ...state.timelines, following: cleared },
    selectedTweetId: undefined,
    selectedDetailId: undefined,
    detailStack: []
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

// The feed copy and the tweet detail copy each hold something the other misses, so the
// merge takes the fuller side of each field instead of one whole copy. The feed sends an
// article as its title alone, and it nests a quote one level, so the quote inside a quote
// reaches the map empty and only the tweet detail can fill it. The other way round, only
// the feed knows who reposted the tweet into it.
export const mergeFocalTweet = (state: AppState, focal: AppTweet): AppState => {
  const existing = state.tweets[focal.id]
  if (existing === undefined) {
    return mergeTweets(state, [focal])
  }
  return mergeTweets(state, [{
    ...existing,
    ...focal,
    text: focal.text.length >= existing.text.length ? focal.text : existing.text,
    media: focal.media.length > 0 ? focal.media : existing.media,
    article: focal.article ?? existing.article,
    quotedTweet: focal.quotedTweet ?? existing.quotedTweet,
    quotedTweetId: focal.quotedTweetId ?? existing.quotedTweetId,
    repostedBy: existing.repostedBy ?? focal.repostedBy
  }])
}

// The drawer writes against the open tweet, not the timeline cursor, so a quote of a
// drilled-in tweet quotes that tweet.
export const openComposer = (state: AppState, mode: ComposerMode): AppState => {
  const target = focusedTweet(state)
  if (!target) {
    return state
  }
  return {
    ...state,
    composer: { open: true, mode, targetTweetId: target.id, draft: '', caret: 0, sending: false },
    status: mode === 'quote' ? `quoting @${target.author.handle}` : `replying to @${target.author.handle}`
  }
}

export const closeComposer = (state: AppState, status = 'composer closed'): AppState =>
  ({ ...state, composer: { open: false, mode: state.composer.mode, draft: '', caret: 0, sending: false }, status })

const withDraft = (state: AppState, draft: string, caret: number): AppState =>
  ({ ...state, composer: { ...state.composer, draft, caret: Math.max(0, Math.min(draft.length, caret)) } })

export const insertIntoDraft = (state: AppState, text: string): AppState => {
  const { draft, caret } = state.composer
  return withDraft(state, `${draft.slice(0, caret)}${text}${draft.slice(caret)}`, caret + text.length)
}

// -1 is Backspace and takes the character behind the caret; 1 is Delete and takes the one
// in front of it.
export const deleteFromDraft = (state: AppState, direction: -1 | 1): AppState => {
  const { draft, caret } = state.composer
  const cut = direction === -1 ? caret - 1 : caret
  if (cut < 0 || cut >= draft.length) {
    return state
  }
  return withDraft(state, `${draft.slice(0, cut)}${draft.slice(cut + 1)}`, cut)
}

// A word jump lands where the word starts, so it first steps over the spaces between them.
const wordEdge = (draft: string, caret: number, step: -1 | 1): number => {
  const at = (index: number): string => (step === -1 ? draft[index - 1] ?? '' : draft[index] ?? '')
  const limit = step === -1 ? 0 : draft.length
  let index = caret
  while (index !== limit && at(index) === ' ') {
    index += step
  }
  while (index !== limit && at(index) !== ' ') {
    index += step
  }
  return index
}

export const moveComposerCaret = (state: AppState, move: CaretMove): AppState => {
  const { draft, caret } = state.composer
  const next = {
    left: caret - 1,
    right: caret + 1,
    start: 0,
    end: draft.length,
    wordLeft: wordEdge(draft, caret, -1),
    wordRight: wordEdge(draft, caret, 1)
  }[move]
  return withDraft(state, draft, next)
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
// An article holds several pictures, so the key names the one on screen: without the slot
// a click on the second picture would only close the first.
export const toggleLightbox = (state: AppState, tweet: AppTweet | undefined, media: AppMedia | undefined, slot?: string): AppState => {
  if (!tweet || !media) {
    return state.lightbox ? { ...state, lightbox: undefined, status: 'closed photo' } : state
  }
  const key = `lightbox:${slot ?? tweet.id}`
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

// X puts up to four pictures on one tweet and draws them as a grid, so the pane owes the
// reader every one of them, not only the first.
export const mediaTileCap = 4

export const previewsOf = (tweet: AppTweet | undefined): AppMedia[] => tweet?.media.slice(0, mediaTileCap) ?? []

export const videoOf = (tweet: AppTweet | undefined): AppVideo | undefined =>
  tweet?.media.find((item): item is AppVideo => item.type !== 'photo' && item.videoUrl !== undefined)

// The detail pane, the replies and every shortcut act on this tweet, not on the
// timeline cursor, so a drilled-in quote behaves like any other open tweet.
// On the notifications tab the row under the cursor names the tweet instead, which is how
// the detail pane, the like key and the reply key keep working there without a second path.
export const focusedTweetId = (state: AppState): string | undefined => {
  const opened = state.detailStack[state.detailStack.length - 1]
  if (opened !== undefined) {
    return opened
  }
  if (state.activeTab === 'notifications') {
    return selectedRow(state)?.tweetId
  }
  return state.selectedTweetId
}

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
  return { ...state, selectedDetailId: id, textFocused: false, status: selectionStatus(state, id) }
}

// The tweet whose replies are still unfetched, if any. One request per tweet is enough:
// the record survives an empty page, so a tweet with no replies is never asked twice.
export const needsReplies = (state: AppState): string | undefined => {
  const id = focusedTweetId(state)
  return id !== undefined && state.tweets[id] && !state.conversations[id] ? id : undefined
}

// R now asks X for what arrived since the last look, so the older pages need their own
// trigger. The feed fetches the next page down once the selection comes within this many
// cards of the end, which keeps j running without a key for it.
const olderPageMargin = 5

export const needsOlderTweets = (state: AppState): boolean => {
  const timeline = activeTimeline(state)
  if (!timeline || timeline.loading || timeline.bottomCursor === undefined || timeline.tweetIds.length === 0) {
    return false
  }
  const index = state.selectedTweetId ? timeline.tweetIds.indexOf(state.selectedTweetId) : -1
  return index >= 0 && index >= timeline.tweetIds.length - olderPageMargin
}

export const needsOlderNotifications = (state: AppState): boolean => {
  const { rows, loading, bottomCursor } = state.notifications
  if (state.activeTab !== 'notifications' || loading || bottomCursor === undefined || rows.length === 0) {
    return false
  }
  const index = state.selectedRowKey ? rows.findIndex((row) => row.key === state.selectedRowKey) : -1
  return index >= 0 && index >= rows.length - olderPageMargin
}

// The plain ← hands the arrows back to the feed without leaving the open tweet.
export const clearDetailSelection = (state: AppState): AppState =>
  state.selectedDetailId === undefined && !state.textFocused
    ? state
    : { ...state, selectedDetailId: undefined, textFocused: false, status: 'back to the feed' }

// The plain right arrow jumps straight to the top of the reply list, whatever the
// cursor was on before.
export const selectFirstReply = (state: AppState): AppState => {
  const id = replyIdsOf(state)[0]
  if (id === undefined) {
    return state
  }
  return { ...state, selectedDetailId: id, textFocused: false, status: selectionStatus(state, id) }
}

// The middle stop of the plain →: the text of the open tweet. An article does not fit the
// pane, so the arrows scroll it here rather than walk a list.
export const focusDetailText = (state: AppState): AppState => {
  const tweet = focusedTweet(state)
  if (!tweet) {
    return state
  }
  const what = tweet.article ? 'article' : 'text'
  return { ...state, selectedDetailId: undefined, textFocused: true, status: `reading the ${what} · ↑/↓ scroll · → replies` }
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
    textFocused: false,
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
    textFocused: false,
    lightbox: undefined,
    status: back ? `back to @${back.author.handle}` : 'back'
  }
}

// The two tweet feeds each hold a timeline; the notifications tab holds rows instead, so it
// answers with nothing and the callers say what to do about it.
export const activeTimeline = (state: AppState): TimelineState | undefined =>
  state.activeTab === 'notifications' ? undefined : state.timelines[state.activeTab]

export const selectRelativeTweet = (state: AppState, delta: number): AppState => {
  const timeline = activeTimeline(state)
  if (!timeline || timeline.tweetIds.length === 0) {
    return state
  }
  const currentIndex = state.selectedTweetId ? timeline.tweetIds.indexOf(state.selectedTweetId) : 0
  const base = currentIndex >= 0 ? currentIndex : 0
  const nextIndex = Math.max(0, Math.min(timeline.tweetIds.length - 1, base + delta))
  // A stale "opened quote" line would otherwise still claim the quote is open.
  const status = state.detailStack.length > 0 ? 'left quote' : state.status
  return { ...state, selectedTweetId: timeline.tweetIds[nextIndex], lightbox: undefined, detailStack: [], selectedDetailId: undefined, textFocused: false, status }
}
