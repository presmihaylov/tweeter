import type { AppMedia, AppProfile, AppTweet, AppVideo, MentionUser, NotificationPage, NotificationRow, UserRelation } from '../twitter/types.ts'
import type { StatsRow, StatsTotals, StatsWindow } from '../stats/aggregate.ts'
import { nextStatsWindow } from '../stats/aggregate.ts'
import { applyMention, mentionQuery } from './mentions.ts'

export type FeedId = 'following' | 'forYou'

// A tab the reader made, which holds one search. The prefix keeps such an id apart from the
// fixed ones, so a search for "following" can never stand in for the feed of that name.
export type SearchTabId = `search:${string}`

// Every tab that holds a timeline: the two feeds, and each search the reader added.
export type TimelineId = FeedId | SearchTabId

// Notifications are a tab but not a timeline: they hold rows, and a row is either a tweet or
// an aggregated line. Keeping the two apart lets the type checker prove that every place
// which needs a timeline still names one of the timeline tabs.
export type TabId = TimelineId | 'notifications'

export const isSearchTab = (tab: TabId): tab is SearchTabId => tab.startsWith('search:')

// The query as the reader typed it, under the id the tabs are keyed by.
export type SearchTab = { id: SearchTabId; query: string }

// What x.com calls "Sort by" on the Following tab. Recent is what X gives a client that
// asks for nothing, so it stays the default here too.
export type FeedSort = 'recent' | 'popular'

export type TimelineState = {
  id: TimelineId
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

// What the stats page holds while it is up. The rows are already counted, because counting
// them needs a clock and a follower log that the screen has no business reading.
export type StatsState = {
  open: boolean
  window: StatsWindow
  loading: boolean
  error?: string
  rows: StatsRow[]
  totals?: StatsTotals
  profile?: AppProfile
  // The widest window the fetched pages already answer for. A window inside it needs no
  // second read, so pressing w back and forth costs nothing.
  loadedWindow?: StatsWindow
  scroll: number
}

// The three modes that send the draft to X. A reply answers the tweet the reader is on, a
// quote reposts it with the draft on top, and a post answers nothing.
export type WriteMode = 'reply' | 'quote' | 'post'

// The drawer is the one text field in the app, so the search prompt borrows it rather than
// grow a second one. Its mode never reaches the write path: it makes a tab instead.
export type ComposerMode = WriteMode | 'search'

// Where the next character lands, counted in characters from the start of the draft. The
// drawer is a text field, so a keystroke acts here and not at the end of the draft.
export type CaretMove = 'left' | 'right' | 'start' | 'end' | 'wordLeft' | 'wordRight'

// The accounts on offer for the @ the caret sits in. The query is kept beside them because
// the reader keeps typing while the read runs, and an answer to an older query is stale.
export type MentionsState = { query: string; users: MentionUser[]; index: number; loading: boolean }

export type AppState = {
  tweets: Record<string, AppTweet>
  // What stands between you and each account you have seen, keyed by user id. It sits here
  // rather than on the tweet, because one account writes many tweets and a follow has to
  // move all of their cards at once.
  relations: Record<string, UserRelation>
  activeTab: TabId
  feedSort: FeedSort
  timelines: Record<TimelineId, TimelineState>
  // The tabs the reader added, in the order the rail lists them, after the fixed three.
  searchTabs: SearchTab[]
  notifications: NotificationsState
  conversations: Record<string, ConversationState>
  selectedTweetId?: string
  // The notifications tab walks rows, not tweets, so it keeps its own cursor. A row names
  // the tweet it is about, and focusedTweetId reads it from here while that tab is up.
  selectedRowKey?: string
  composer: { open: boolean; mode: ComposerMode; targetTweetId?: string; draft: string; caret: number; error?: string; sending: boolean }
  // The @ menu over the drawer. It is absent unless the caret sits in a mention, so the one
  // field says both whether the menu is up and what it is offering.
  mentions?: MentionsState
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
  // The replies have a view of their own, so a tweet with a photo and a quote under it
  // keeps every row of the pane for itself. This names the tweet whose list is open rather
  // than raising a flag, so the view ends by itself once another tweet takes the pane.
  repliesOpenFor?: string
  // The key list outgrew the header row, so it lives in a popup that ? opens and closes.
  helpOpen: boolean
  // A short terminal cannot hold every key at once, so the popup scrolls. The screen owns
  // how far it can go, because only the screen knows how many rows it has.
  helpScroll: number
  // The stats page, which counts what you wrote day by day. It keeps its own rows rather
  // than reading the feed: the profile timeline is a different read, and a month of it does
  // not belong in the tweet store the panes draw from.
  stats: StatsState
  // What a copy left on the clipboard, shown in the corner for a moment. The status line
  // holds one line for the whole app, so a copy there would sit under the reader's eye at
  // the far end of the window and be gone before it is read.
  toast?: string
  status: string
}

export const initialAppState = (): AppState => ({
  tweets: {},
  relations: {},
  activeTab: 'following',
  feedSort: 'recent',
  timelines: {
    following: { id: 'following', tweetIds: [], loading: false },
    forYou: { id: 'forYou', tweetIds: [], loading: false }
  },
  searchTabs: [],
  notifications: { rows: [], loading: false, unread: 0 },
  conversations: {},
  composer: { open: false, mode: 'reply', draft: '', caret: 0, sending: false },
  detailStack: [],
  textFocused: false,
  helpOpen: false,
  helpScroll: 0,
  stats: { open: false, window: 7, loading: false, rows: [], scroll: 0 },
  status: 'starting'
})

export const toggleStats = (state: AppState): AppState => ({
  ...state,
  stats: { ...state.stats, open: !state.stats.open, scroll: 0 },
  helpOpen: false
})

export const closeStats = (state: AppState): AppState =>
  state.stats.open ? { ...state, stats: { ...state.stats, open: false, scroll: 0 } } : state

// The window walks 7 → 14 → 30 and back. The rows it already has stay on the screen until
// the wider read answers, so the page never blanks under the reader.
export const turnStatsWindow = (state: AppState): AppState => ({
  ...state,
  stats: { ...state.stats, window: nextStatsWindow(state.stats.window), scroll: 0 }
})

export const beginStatsLoad = (state: AppState): AppState => ({
  ...state,
  stats: { ...state.stats, loading: true, error: undefined }
})

export const failStatsLoad = (state: AppState, error: string): AppState => ({
  ...state,
  stats: { ...state.stats, loading: false, error }
})

// The rows land page by page, so a merge can carry a table that is still filling in. Only
// the last merge of a load clears the loading flag.
export const mergeStats = (state: AppState, load: { rows: StatsRow[]; totals: StatsTotals; profile?: AppProfile; loadedWindow: StatsWindow; loading?: boolean }): AppState => ({
  ...state,
  stats: {
    ...state.stats,
    loading: load.loading ?? false,
    error: undefined,
    rows: load.rows,
    totals: load.totals,
    profile: load.profile ?? state.stats.profile,
    loadedWindow: load.loadedWindow
  }
})

export const scrollStats = (state: AppState, delta: number, max: number): AppState => {
  const scroll = Math.max(0, Math.min(max, state.stats.scroll + delta))
  return scroll === state.stats.scroll ? state : { ...state, stats: { ...state.stats, scroll } }
}

export const toggleHelp = (state: AppState): AppState => ({ ...state, helpOpen: !state.helpOpen, helpScroll: 0 })

export const closeHelp = (state: AppState): AppState =>
  state.helpOpen ? { ...state, helpOpen: false, helpScroll: 0 } : state

export const showToast = (state: AppState, toast: string): AppState => ({ ...state, toast })

export const clearToast = (state: AppState): AppState =>
  state.toast === undefined ? state : { ...state, toast: undefined }

export const scrollHelp = (state: AppState, delta: number, max: number): AppState => {
  const helpScroll = Math.max(0, Math.min(max, state.helpScroll + delta))
  return helpScroll === state.helpScroll ? state : { ...state, helpScroll }
}

// Only the flags X actually sent. A page that carries none must not erase what an earlier
// page, or a follow of your own, already established.
const relationFrom = (author: AppTweet['author']): UserRelation | undefined => {
  const relation: UserRelation = {}
  if (author.following !== undefined) {
    relation.following = author.following
  }
  if (author.followedBy !== undefined) {
    relation.followedBy = author.followedBy
  }
  return Object.keys(relation).length > 0 ? relation : undefined
}

export const mergeTweets = (state: AppState, tweets: AppTweet[]): AppState => {
  const nextTweets = { ...state.tweets }
  const relations = { ...state.relations }
  const remember = (tweet: AppTweet): void => {
    nextTweets[tweet.id] = tweet
    const relation = relationFrom(tweet.author)
    const authorId = tweet.author.id
    if (authorId !== undefined && relation) {
      relations[authorId] = { ...relations[authorId], ...relation }
    }
  }
  for (const tweet of tweets) {
    remember(tweet)
    if (tweet.quotedTweet) {
      remember(tweet.quotedTweet)
    }
  }
  return { ...state, tweets: nextTweets, relations }
}

// The overlay answers first, because a follow moves it and not the copies the cards hold.
// An author X gave no id for still has the flags that came with the tweet.
export const relationOf = (state: AppState, tweet: AppTweet | undefined): UserRelation | undefined => {
  if (!tweet) {
    return undefined
  }
  const authorId = tweet.author.id
  const kept = authorId === undefined ? undefined : state.relations[authorId]
  return kept ?? relationFrom(tweet.author)
}

// The badge moves before X answers, the way the heart does on a like.
export const applyFollow = (state: AppState, userId: string, following: boolean): AppState => ({
  ...state,
  relations: { ...state.relations, [userId]: { ...state.relations[userId], following } }
})

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

export const emptyTimeline = (id: TimelineId): TimelineState => ({ id, tweetIds: [], loading: false })

export const mergeTimelinePage = (state: AppState, feed: TimelineId, tweets: AppTweet[], cursors: { topCursor?: string; bottomCursor?: string }, placement: PagePlacement = 'bottom'): AppState => {
  const merged = mergeTweets(state, tweets)
  const existing = merged.timelines[feed] ?? emptyTimeline(feed)
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

// A notice that stands for a list draws its posts under it, in the same row list, so j and k
// walk them and every tweet key acts on them. Each post names the notice it came from, which is
// how it is drawn as part of that line and taken away again.
export const expandNotice = (state: AppState, key: string, page: NotificationPage): AppState => {
  const merged = mergeTweets(state, page.tweets)
  const rows = merged.notifications.rows.filter((row) => row.parentKey !== key)
  const index = rows.findIndex((row) => row.key === key)
  if (index < 0) {
    return merged
  }
  const nested = page.rows.map((row) => ({ ...row, key: `${key}/${row.key}`, parentKey: key }))
  return {
    ...merged,
    notifications: {
      ...merged.notifications,
      rows: [...rows.slice(0, index + 1), ...nested, ...rows.slice(index + 1)],
      loading: false,
      error: undefined
    }
  }
}

export const collapseNotice = (state: AppState, key: string): AppState => {
  const rows = state.notifications.rows.filter((row) => row.parentKey !== key)
  return {
    ...state,
    notifications: { ...state.notifications, rows },
    // The cursor cannot stay on a row that is gone, so it falls back to the line it came from.
    selectedRowKey: rows.some((row) => row.key === state.selectedRowKey) ? state.selectedRowKey : key
  }
}

export const noticeExpanded = (state: AppState, key: string): boolean =>
  state.notifications.rows.some((row) => row.parentKey === key)

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
  return { ...state, selectedRowKey: rows[nextIndex]?.key, lightbox: undefined, detailStack: [], selectedDetailId: undefined, repliesOpenFor: undefined, textFocused: false, status }
}

// The id is the query itself, folded to one case and stripped of its edges, so asking twice
// for the same words lands on the tab that is already open rather than making a second one.
export const searchTabIdOf = (query: string): SearchTabId => `search:${query.trim().toLowerCase()}`

export const searchQueryOf = (state: AppState, tab: TabId): string | undefined =>
  state.searchTabs.find((entry) => entry.id === tab)?.query

// The order the rail lists them and Tab walks them: the three fixed tabs, then the ones the
// reader added, oldest first.
export const tabOrder = (state: AppState): TabId[] =>
  ['following', 'forYou', 'notifications', ...state.searchTabs.map((entry) => entry.id)]

// A query that is already a tab wins its tab back instead of opening a second one. The new
// tab starts empty, so the caller fetches its first page.
export const addSearchTab = (state: AppState, query: string): AppState => {
  const trimmed = query.trim()
  if (trimmed === '') {
    return state
  }
  const id = searchTabIdOf(trimmed)
  const opened = { ...state, activeTab: id, selectedTweetId: state.timelines[id]?.tweetIds[0], detailStack: [], selectedDetailId: undefined, repliesOpenFor: undefined, textFocused: false }
  if (state.searchTabs.some((entry) => entry.id === id)) {
    return { ...opened, status: `back on ${trimmed}` }
  }
  return {
    ...opened,
    searchTabs: [...state.searchTabs, { id, query: trimmed }],
    timelines: { ...state.timelines, [id]: emptyTimeline(id) },
    status: `searching ${trimmed}`
  }
}

// The tweets the tab held stay in the store, because other tabs may draw the same ones. What
// goes is the tab, its list and the cursor, and the reader lands on the tab before it.
export const removeSearchTab = (state: AppState, id: SearchTabId): AppState => {
  const going = state.searchTabs.findIndex((entry) => entry.id === id)
  if (going < 0) {
    return state
  }
  const searchTabs = state.searchTabs.filter((entry) => entry.id !== id)
  // Rebuilt from the tabs that remain, so the list the tab held goes with it.
  const timelines: Record<TimelineId, TimelineState> = { following: state.timelines.following, forYou: state.timelines.forYou }
  for (const entry of searchTabs) {
    const kept = state.timelines[entry.id]
    if (kept) {
      timelines[entry.id] = kept
    }
  }
  const order = tabOrder(state)
  const before = order[order.indexOf(id) - 1] ?? 'following'
  const activeTab = state.activeTab === id ? before : state.activeTab
  return {
    ...state,
    searchTabs,
    timelines,
    activeTab,
    selectedTweetId: activeTab === 'notifications' ? undefined : timelines[activeTab]?.tweetIds[0],
    detailStack: [],
    selectedDetailId: undefined,
    repliesOpenFor: undefined,
    textFocused: false,
    status: `closed ${state.searchTabs[going]?.query ?? 'the tab'}`
  }
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
  // A new post answers no tweet, and neither does a search, so the drawer opens with nothing
  // behind it and the feed selection stays where it was.
  if (mode === 'post' || mode === 'search') {
    return {
      ...state,
      composer: { open: true, mode, targetTweetId: undefined, draft: '', caret: 0, sending: false },
      mentions: undefined,
      status: mode === 'search' ? 'type a search' : 'writing a new post'
    }
  }
  const target = focusedTweet(state)
  if (!target) {
    return state
  }
  return {
    ...state,
    composer: { open: true, mode, targetTweetId: target.id, draft: '', caret: 0, sending: false },
    mentions: undefined,
    status: mode === 'quote' ? `quoting @${target.author.handle}` : `replying to @${target.author.handle}`
  }
}

export const closeComposer = (state: AppState, status = 'composer closed'): AppState =>
  ({ ...state, composer: { open: false, mode: state.composer.mode, draft: '', caret: 0, sending: false }, mentions: undefined, status })

// The menu follows the caret, so every change to the draft asks the same question: is the
// caret in a mention, and is it still the same one. A menu already open on that query keeps
// the accounts it holds, so a keystroke does not blank the list while the next read runs.
const mentionsFor = (state: AppState, draft: string, caret: number): MentionsState | undefined => {
  const query = mentionQuery(draft, caret)
  if (query === undefined) {
    return undefined
  }
  return state.mentions?.query === query ? state.mentions : { query, users: [], index: 0, loading: true }
}

const withDraft = (state: AppState, draft: string, caret: number): AppState => {
  const safeCaret = Math.max(0, Math.min(draft.length, caret))
  return { ...state, composer: { ...state.composer, draft, caret: safeCaret }, mentions: mentionsFor(state, draft, safeCaret) }
}

// The query the drawer is waiting on, if it is waiting on one. The read costs a request per
// query, so the app asks this rather than fetch on every keystroke.
export const needsMentions = (state: AppState): string | undefined =>
  state.mentions?.loading === true ? state.mentions.query : undefined

// An answer to a query the reader has already typed past is thrown away. The accounts carry
// both relationship flags, so they fill the same map a follow moves.
export const mergeMentionUsers = (state: AppState, query: string, users: MentionUser[]): AppState => {
  if (state.mentions?.query !== query) {
    return state
  }
  const relations = { ...state.relations }
  for (const user of users) {
    const relation: UserRelation = {}
    if (user.following !== undefined) {
      relation.following = user.following
    }
    if (user.followedBy !== undefined) {
      relation.followedBy = user.followedBy
    }
    if (user.id !== '' && Object.keys(relation).length > 0) {
      relations[user.id] = { ...relations[user.id], ...relation }
    }
  }
  return { ...state, relations, mentions: { query, users, index: 0, loading: false } }
}

// The list is short and the reader walks it with the same keys everywhere else, so it wraps
// rather than stop at either end.
export const moveMention = (state: AppState, step: number): AppState => {
  const mentions = state.mentions
  if (!mentions || mentions.users.length === 0) {
    return state
  }
  const count = mentions.users.length
  const index = (((mentions.index + step) % count) + count) % count
  return { ...state, mentions: { ...mentions, index } }
}

export const closeMentions = (state: AppState): AppState =>
  state.mentions ? { ...state, mentions: undefined } : state

// The handle takes the place of what was typed. The menu closes with it, because the caret
// then sits after a space and no longer in a mention.
export const chooseMention = (state: AppState): AppState => {
  const chosen = state.mentions?.users[state.mentions.index]
  if (!chosen) {
    return state
  }
  const written = applyMention(state.composer.draft, state.composer.caret, chosen.handle)
  return { ...withDraft(state, written.draft, written.caret), status: `tagged @${chosen.handle}` }
}

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

// Whether the pane draws the reply list instead of the tweet.
export const repliesOpen = (state: AppState): boolean =>
  state.repliesOpenFor !== undefined && state.repliesOpenFor === focusedTweetId(state)

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
  // The cursor and the pane show the same thing: a reply opens the list, and the parent
  // card is drawn beside the tweet, so landing on it closes the list again.
  const onReply = replyIdsOf(state).includes(id)
  return {
    ...state,
    selectedDetailId: id,
    repliesOpenFor: onReply ? focusedTweetId(state) : undefined,
    textFocused: false,
    status: selectionStatus(state, id)
  }
}

// The click on the replies header, and the c key, open the list on their own. The tweet
// itself keeps the whole pane while the list is shut.
export const openReplies = (state: AppState): AppState => {
  const id = focusedTweetId(state)
  if (id === undefined) {
    return state
  }
  const first = replyIdsOf(state)[0]
  return {
    ...state,
    repliesOpenFor: id,
    selectedDetailId: first,
    textFocused: false,
    status: first !== undefined ? selectionStatus(state, first) : 'replies open · ← closes them'
  }
}

export const closeReplies = (state: AppState): AppState =>
  state.repliesOpenFor === undefined
    ? state
    : { ...state, repliesOpenFor: undefined, selectedDetailId: undefined, status: 'back to the tweet' }

export const toggleReplies = (state: AppState): AppState =>
  repliesOpen(state) ? closeReplies(state) : openReplies(state)

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

// The plain ← hands the arrows back to the feed without leaving the open tweet. It shuts
// the reply list on the way, because that list is where the arrows most often are.
export const clearDetailSelection = (state: AppState): AppState =>
  state.selectedDetailId === undefined && !state.textFocused && state.repliesOpenFor === undefined
    ? state
    : { ...state, selectedDetailId: undefined, repliesOpenFor: undefined, textFocused: false, status: 'back to the feed' }

// The plain right arrow opens the reply list and lands on its first card, whatever the
// cursor was on before.
export const selectFirstReply = (state: AppState): AppState => {
  const id = replyIdsOf(state)[0]
  if (id === undefined) {
    return openReplies(state)
  }
  return { ...state, selectedDetailId: id, repliesOpenFor: focusedTweetId(state), textFocused: false, status: selectionStatus(state, id) }
}

// The middle stop of the plain →: the text of the open tweet. An article does not fit the
// pane, so the arrows scroll it here rather than walk a list.
export const focusDetailText = (state: AppState): AppState => {
  const tweet = focusedTweet(state)
  if (!tweet) {
    return state
  }
  const what = tweet.article ? 'article' : 'text'
  return { ...state, selectedDetailId: undefined, repliesOpenFor: undefined, textFocused: true, status: `reading the ${what} · ↑/↓ scroll · → replies` }
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
  return { ...state, selectedTweetId: timeline.tweetIds[nextIndex], lightbox: undefined, detailStack: [], selectedDetailId: undefined, repliesOpenFor: undefined, textFocused: false, status }
}
