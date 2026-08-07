import { CliRenderEvents, createCliRenderer } from '@opentui/core'
import type { AppMedia, AuthStatus, PostResult, WriteRetryNotice } from '../twitter/types.ts'
import { TwitterClient } from '../twitter/client.ts'
import { tweetTextLimit } from '../twitter/constants.ts'
import type { TweeterConfig, TweeterProfile } from '../config/schema.ts'
import { ConfigStore } from '../config/store.ts'
import { applyBookmark, applyLike, beginConversationLoad, clearDetailSelection, closeComposer, deleteFromDraft, enterSelection, failConversationLoad, focusDetailText, focusedTweet, initialAppState, insertIntoDraft, leaveSelection, mergeConversationPage, mergeFocalTweet, mergeTimelinePage, moveComposerCaret, needsOlderTweets, needsReplies, openComposer, previewOf, previewsOf, selectFirstReply, selectRelativeDetail, selectRelativeTweet, setFeedSort, toggleLightbox, videoOf, type AppState, type FeedId, type TimelineState } from '../state/store.ts'
import { createMainScreen, retryStatus, writeFailure } from './mainScreen.ts'
import { errorMessage } from '../utils/result.ts'
import { createDebugLogger } from '../utils/debugLog.ts'
import { createOnboardingScreen } from './onboardingScreen.ts'
import { caretMoveFor, isCtrlEnterKey, isEnterKey, isTextInput } from './keyEvents.ts'
import { createImageLayer, writeToTerminal, type ImagePlacement } from '../media/imageLayer.ts'
import { cellSize } from '../media/geometry.ts'
import { detectImageRenderer } from '../media/detect.ts'
import { kittyDeleteAll } from '../media/kitty.ts'
import { openExternal, tweetUrl } from '../media/openExternal.ts'

// Which end of the feed a fetch asks for. X gives a page two cursors that point opposite
// ways, so the mode picks the cursor and the mode picks where the page lands.
export type FeedLoad = 'initial' | 'newer' | 'older'

export const cursorFor = (timeline: TimelineState, mode: FeedLoad): string | undefined => {
  if (mode === 'newer') {
    return timeline.topCursor
  }
  if (mode === 'older') {
    return timeline.bottomCursor
  }
  return undefined
}

export const feedLoadStatus = (mode: FeedLoad): string => {
  if (mode === 'newer') {
    return 'checking for new tweets'
  }
  if (mode === 'older') {
    return 'loading older tweets'
  }
  return 'loading feed'
}

export const feedLoadResult = (mode: FeedLoad, added: number): string => {
  if (mode === 'newer') {
    return added > 0 ? `${added} new tweets` : 'no new tweets'
  }
  if (mode === 'older') {
    return added > 0 ? `${added} older tweets` : 'no older tweets'
  }
  return `loaded ${added} tweets`
}

export type TerminalAppOptions = {
  config: TweeterConfig
  profileName?: string
  profile?: TweeterProfile
  renderer?: 'auto' | 'chafa' | 'kitty' | 'none'
  debugLog?: string
}

export const runTerminalApp = async (opts: TerminalAppOptions): Promise<void> => {
  const renderer = await createCliRenderer({
    screenMode: 'alternate-screen',
    useMouse: true,
    exitOnCtrlC: true,
    targetFps: 30,
    clearOnShutdown: true,
    // On macOS OpenTUI paints from a background thread by default. A kitty escape too
    // large for one write then gets split by a frame, and the terminal prints the rest
    // of the base64 as text. Paint on this thread so the image writes stay whole.
    useThread: false
  })
  renderer.start()
  const debugLogger = createDebugLogger(opts.debugLog)

  const startAuthenticated = async (config: TweeterConfig, profileName: string, profile: TweeterProfile): Promise<void> => {
    let state: AppState = initialAppState()
    const session: { auth?: AuthStatus } = {}

    // A tweet holds up to four pictures, so the index says which tile the reader clicked.
    const openPhoto = (source: 'tweet' | 'quote', index = 0): void => {
      const focused = focusedTweet(state)
      const tweet = source === 'quote' ? focused?.quotedTweet : focused
      const media = previewsOf(tweet)[index]
      state = toggleLightbox(state, tweet, media, tweet ? `${tweet.id}:${index}` : undefined)
      rerender()
    }
    // An article image belongs to the body, not to the tweet, so it carries its own key.
    const openArticleImage = (media: AppMedia, key: string): void => {
      state = toggleLightbox(state, focusedTweet(state), media, key)
      rerender()
    }
    const closePhoto = (): void => {
      state = toggleLightbox(state, undefined, undefined)
      rerender()
    }
    const openSelection = (tweetId?: string): void => {
      state = enterSelection(state, tweetId)
      rerender()
    }
    const screen = createMainScreen(renderer, {
      onOpenPhoto: openPhoto,
      onCloseLightbox: closePhoto,
      onOpenQuote: () => { openSelection() },
      onOpenTweet: (tweetId) => { openSelection(tweetId) },
      onOpenArticleImage: openArticleImage
    })
    const client = new TwitterClient({ authToken: profile.authToken, ct0: profile.ct0, cookieHeader: profile.cookieHeader, debugLogger })
    attachImageLayer(screen)

    // A tweet fetches its own replies as soon as the reader rests on it. The delay lets
    // j/k fly down the feed without a request for every tweet it passes.
    let replyTimer: ReturnType<typeof setTimeout> | undefined
    const scheduleReplies = (): void => {
      clearTimeout(replyTimer)
      const tweetId = needsReplies(state)
      if (tweetId === undefined) {
        return
      }
      replyTimer = setTimeout(() => {
        if (needsReplies(state) === tweetId) {
          void loadReplies(tweetId)
        }
      }, 300)
    }

    // The end of the feed pulls the next page down on its own, because R now asks for what
    // is new instead. The same delay keeps a fast j from queueing a fetch per keystroke.
    let olderTimer: ReturnType<typeof setTimeout> | undefined
    const scheduleOlderTweets = (): void => {
      clearTimeout(olderTimer)
      if (!needsOlderTweets(state)) {
        return
      }
      olderTimer = setTimeout(() => {
        if (needsOlderTweets(state)) {
          void loadOlder()
        }
      }, 300)
    }

    const rerender = (): void => {
      screen.render(state, session.auth)
      scheduleReplies()
      scheduleOlderTweets()
    }
    // Pane heights drive the detail row budget, so a resize needs a fresh pass.
    renderer.on(CliRenderEvents.RESIZE, rerender)

    const loadFeed = async (feed: FeedId, mode: FeedLoad): Promise<void> => {
      const before = state.timelines[feed].tweetIds.length
      state = { ...state, activeFeed: feed, timelines: { ...state.timelines, [feed]: { ...state.timelines[feed], loading: true, error: undefined } }, status: feedLoadStatus(mode) }
      rerender()
      try {
        const page = await client.loadHomeTimelinePage({
          count: 40,
          following: feed === 'following',
          ranked: state.feedSort === 'popular',
          cursor: cursorFor(state.timelines[feed], mode)
        })
        state = mergeTimelinePage(state, feed, page.tweets, page, mode === 'newer' ? 'top' : 'bottom')
        const added = state.timelines[feed].tweetIds.length - before
        // New tweets sit above the selection, where the reader cannot see them, so a
        // refresh that found some also moves the cursor up to them.
        const top = state.timelines[feed].tweetIds[0]
        if (mode === 'newer' && added > 0 && top !== undefined) {
          state = { ...state, selectedTweetId: top, detailStack: [], selectedDetailId: undefined, textFocused: false }
        }
        state = { ...state, status: feedLoadResult(mode, added) }
      } catch (error) {
        state = { ...state, status: 'feed error', timelines: { ...state.timelines, [feed]: { ...state.timelines[feed], loading: false, error: errorMessage(error) } } }
      }
      rerender()
    }

    // One page down at a time, or a fast j would queue a fetch per keystroke.
    let loadingOlder = false
    const loadOlder = async (): Promise<void> => {
      if (loadingOlder) {
        return
      }
      loadingOlder = true
      await loadFeed(state.activeFeed, 'older')
      loadingOlder = false
    }

    const loadReplies = async (tweetId: string): Promise<void> => {
      const cursor = state.conversations[tweetId]?.cursor
      state = beginConversationLoad(state, tweetId)
      rerender()
      try {
        const page = await client.loadRepliesPage({ tweetId, cursor })
        state = mergeConversationPage(state, tweetId, page.replies, page.cursor)
        // An article reaches the feed as its title alone, so the body only lands here.
        state = page.focal ? mergeFocalTweet(state, page.focal) : state
        // The page also carries the thread above the tweet, so count what the pane keeps.
        state = { ...state, status: `loaded ${state.conversations[tweetId]?.replyIds.length ?? 0} replies` }
      } catch (error) {
        state = failConversationLoad(state, tweetId, errorMessage(error))
      }
      rerender()
    }

    // A second press before X answers would race the first one and leave the card showing
    // the wrong heart, so one tweet takes one call at a time.
    const likeInFlight = new Set<string>()

    const toggleLike = async (): Promise<void> => {
      const tweet = focusedTweet(state)
      if (!tweet || likeInFlight.has(tweet.id)) {
        return
      }
      const liked = !(tweet.favorited ?? false)
      likeInFlight.add(tweet.id)
      state = { ...applyLike(state, tweet.id, liked), status: liked ? 'sending like' : 'removing like' }
      rerender()
      const result = await client.setLike({
        tweetId: tweet.id,
        liked,
        onRetry: (notice) => {
          state = { ...state, status: retryStatus('like', notice) }
          rerender()
        }
      })
      likeInFlight.delete(tweet.id)
      if (result.ok) {
        state = { ...state, status: liked ? `liked @${tweet.author.handle}` : `removed the like on @${tweet.author.handle}` }
        rerender()
        return
      }
      await debugLogger.log('ui.like.failed', { tweetId: tweet.id, liked, error: result.error, code: result.code, logPath: debugLogger.path })
      // X kept the old state, so the card has to go back to it rather than lie.
      state = { ...applyLike(state, tweet.id, !liked), status: `like failed: ${result.error}; log: ${debugLogger.path}` }
      rerender()
    }

    const bookmarkInFlight = new Set<string>()

    const toggleBookmark = async (): Promise<void> => {
      const tweet = focusedTweet(state)
      if (!tweet || bookmarkInFlight.has(tweet.id)) {
        return
      }
      const bookmarked = !(tweet.bookmarked ?? false)
      bookmarkInFlight.add(tweet.id)
      state = { ...applyBookmark(state, tweet.id, bookmarked), status: bookmarked ? 'adding bookmark' : 'removing bookmark' }
      rerender()
      const result = await client.setBookmark({
        tweetId: tweet.id,
        bookmarked,
        onRetry: (notice) => {
          state = { ...state, status: retryStatus('bookmark', notice) }
          rerender()
        }
      })
      bookmarkInFlight.delete(tweet.id)
      if (result.ok) {
        state = { ...state, status: bookmarked ? `bookmarked @${tweet.author.handle}` : `removed the bookmark on @${tweet.author.handle}` }
        rerender()
        return
      }
      await debugLogger.log('ui.bookmark.failed', { tweetId: tweet.id, bookmarked, error: result.error, code: result.code, logPath: debugLogger.path })
      state = { ...applyBookmark(state, tweet.id, !bookmarked), status: `bookmark failed: ${result.error}; log: ${debugLogger.path}` }
      rerender()
    }

    const sendComposer = async (): Promise<void> => {
      const targetId = state.composer.targetTweetId
      const target = targetId ? state.tweets[targetId] : undefined
      const mode = state.composer.mode
      const what = mode === 'quote' ? 'quote' : 'reply'
      const text = state.composer.draft.trim()
      if (!target || text === '') {
        return
      }
      // X counts the characters itself, but a local check saves a round trip and keeps
      // the draft in the composer instead of losing it to a server refusal.
      if (text.length > tweetTextLimit) {
        const message = `the ${what} is ${text.length} characters; the limit is ${tweetTextLimit}`
        state = { ...state, composer: { ...state.composer, sending: false, error: message }, status: message }
        rerender()
        return
      }
      state = { ...state, composer: { ...state.composer, sending: true, error: undefined }, status: `sending ${what}` }
      rerender()
      await debugLogger.log('ui.composer.submit', { mode, targetTweetId: target.id, textLength: text.length })
      const onRetry = (notice: WriteRetryNotice): void => {
        state = { ...state, status: retryStatus(what, notice) }
        rerender()
      }
      const result: PostResult = mode === 'quote'
        ? await client.quoteTweet({ tweetId: target.id, handle: target.author.handle, text, onRetry })
        : await client.replyToTweet({ tweetId: target.id, text, onRetry })
      if (result.ok) {
        state = { ...closeComposer(state, `sent ${what} ${result.tweetId}`) }
        rerender()
        return
      }
      await debugLogger.log('ui.composer.failed', { mode, targetTweetId: target.id, error: result.error, status: result.status, code: result.code, logPath: debugLogger.path })
      const failure = writeFailure(what, result, debugLogger.path)
      state = { ...state, composer: { ...state.composer, sending: false, error: failure.error }, status: failure.status }
      rerender()
    }

    renderer.keyInput.on('keypress', (key) => {
      // An enlarged photo swallows q and Esc; quitting from it would surprise the reader.
      if (state.lightbox && (key.name === 'q' || key.name === 'escape' || key.name === 'p' || isEnterKey(key))) {
        closePhoto()
        return
      }
      if (key.name === 'q' && !state.composer.open) {
        renderer.destroy()
        return
      }
      if (key.name === 'escape') {
        state = closeComposer(state)
        rerender()
        return
      }
      // The drawer is a text field while it is open, so it answers every key itself.
      if (state.composer.open) {
        if (isCtrlEnterKey(key) || isEnterKey(key)) {
          void sendComposer()
          return
        }
        const move = caretMoveFor(key)
        if (move) {
          state = moveComposerCaret(state, move)
          rerender()
          return
        }
        if (key.name === 'backspace' || key.name === 'delete') {
          state = deleteFromDraft(state, key.name === 'delete' ? 1 : -1)
          rerender()
          return
        }
        if (isTextInput(key)) {
          state = insertIntoDraft(state, key.sequence)
          rerender()
        }
        return
      }
      // A long tweet does not fit the pane, so the text scrolls under a fixed header.
      if (key.ctrl && (key.name === 's' || key.name === 'w')) {
        screen.scrollDetail(key.name === 's' ? 3 : -3)
        rerender()
        return
      }
      // Shift+arrows walk the detail pane: up/down pick the parent card or a reply,
      // right opens the pick, left comes back. The plain arrows stay on the timeline.
      if (key.shift && (key.name === 'down' || key.name === 'j')) {
        state = selectRelativeDetail(state, 1)
        rerender()
        return
      }
      if (key.shift && (key.name === 'up' || key.name === 'k')) {
        state = selectRelativeDetail(state, -1)
        rerender()
        return
      }
      if (key.shift && (key.name === 'right' || key.name === 'l')) {
        openSelection()
        return
      }
      if (key.shift && (key.name === 'left' || key.name === 'h')) {
        state = leaveSelection(state)
        rerender()
        return
      }
      // The plain arrows follow the focus: → walks it rightwards through the pane, ← hands
      // it back to the feed, and ↑/↓ work on whatever holds it. j/k always stay on the feed.
      // The text is a stop of its own only when it does not fit, so a short tweet keeps the
      // old walk, where → lands straight on the replies.
      if (key.name === 'right') {
        state = state.textFocused || state.selectedDetailId !== undefined || !screen.detailScrolls()
          ? selectFirstReply(state)
          : focusDetailText(state)
        rerender()
        return
      }
      if (key.name === 'left') {
        state = state.selectedDetailId !== undefined || state.textFocused ? clearDetailSelection(state) : leaveSelection(state)
        rerender()
        return
      }
      // An article is thousands of characters, so the arrows scroll it a line at a time.
      // Ctrl+S and Ctrl+W still page it from anywhere.
      if (state.textFocused && (key.name === 'down' || key.name === 'up')) {
        screen.scrollDetail(key.name === 'down' ? 1 : -1)
        rerender()
        return
      }
      if (key.name === 'down' && state.selectedDetailId) {
        state = selectRelativeDetail(state, 1)
        rerender()
        return
      }
      if (key.name === 'up' && state.selectedDetailId) {
        state = selectRelativeDetail(state, -1)
        rerender()
        return
      }
      if (key.name === 'j' || key.name === 'down') {
        state = selectRelativeTweet(state, 1)
        rerender()
        return
      }
      if (key.name === 'k' || key.name === 'up') {
        state = selectRelativeTweet(state, -1)
        rerender()
        return
      }
      if (key.name === 'tab') {
        const next = state.activeFeed === 'following' ? 'forYou' : 'following'
        // A feed the reader already opened keeps its tweets and its place, so Tab only
        // fetches the first page of a feed that holds nothing yet.
        if (state.timelines[next].tweetIds.length > 0) {
          state = { ...state, activeFeed: next, selectedTweetId: state.timelines[next].tweetIds[0], detailStack: [], selectedDetailId: undefined, textFocused: false, status: 'switched feed' }
          rerender()
          return
        }
        void loadFeed(next, 'initial')
        return
      }
      // Only the Following feed carries a sort. On For You the key would silently do
      // nothing, so say so instead.
      if (key.name === 's') {
        if (state.activeFeed !== 'following') {
          state = { ...state, status: 'sort applies to the Following feed only' }
          rerender()
          return
        }
        state = setFeedSort(state, state.feedSort === 'popular' ? 'recent' : 'popular')
        void loadFeed('following', 'initial')
        return
      }
      // Shift+R arrives as name 'r' with shift set, so refresh must win over the reply composer.
      if (key.name === 'R' || (key.shift && key.name === 'r')) {
        void loadFeed(state.activeFeed, 'newer')
        return
      }
      // Shift+L already opens the selection, so plain l alone is the like.
      if (key.name === 'l' && !key.shift) {
        void toggleLike()
        return
      }
      if (key.name === 'b') {
        void toggleBookmark()
        return
      }
      if (key.name === 'r') {
        state = openComposer(state, 'reply')
        rerender()
        return
      }
      // x.com puts the repost on t, and a repost here always carries the reader's own words:
      // the plain repost is the one write the TUI does not do.
      if (key.name === 't') {
        state = openComposer(state, 'quote')
        rerender()
        return
      }
      if (key.name === 'p') {
        const focused = focusedTweet(state)
        if (!focused) {
          return
        }
        const inArticle = previewOf(focused) ? undefined : screen.visibleArticleImage()
        if (inArticle) {
          openArticleImage(inArticle.media, inArticle.key)
          return
        }
        openPhoto(previewOf(focused) ? 'tweet' : 'quote')
        return
      }
      if (key.name === 'o') {
        const tweet = focusedTweet(state)
        if (tweet) {
          openExternal(tweetUrl(tweet))
          state = { ...state, status: `opened ${tweetUrl(tweet)}` }
          rerender()
        }
        return
      }
      // The terminal draws the still frame; the system player gets the mp4 itself.
      if (key.name === 'v') {
        const video = videoOf(focusedTweet(state)) ?? videoOf(focusedTweet(state)?.quotedTweet)
        state = { ...state, status: video?.videoUrl ? 'playing the video' : 'no video on this tweet' }
        if (video?.videoUrl) {
          openExternal(video.videoUrl)
        }
        rerender()
        return
      }
      // The first page arrives on its own, so Enter is only how the reader asks for more.
      if (isEnterKey(key)) {
        const tweetId = focusedTweet(state)?.id
        if (tweetId) {
          void loadReplies(tweetId)
        }
      }
    })

    state = { ...state, status: `validating ${profileName}` }
    rerender()
    const feed = config.ui?.defaultFeed === 'forYou' ? 'forYou' : 'following'
    await loadFeed(feed, 'initial')
    // The feed load is itself an auth probe; only spend a second request when it comes back empty.
    session.auth = state.timelines[feed].tweetIds.length > 0
      ? { ok: true, source: 'timeline' }
      : await client.checkAuth()
    state = { ...state, status: session.auth.ok ? state.status : session.auth.error }
    rerender()
  }

  // Kitty graphics live outside the OpenTUI frame buffer, so images are diffed and
  // written straight to stdout after each painted frame.
  const attachImageLayer = (screen: { placements(): ImagePlacement[] }): void => {
    if (detectImageRenderer(opts.renderer ?? 'auto') !== 'kitty') {
      return
    }
    // The first frame carries the least interesting placements, so the log follows every
    // change of the key set instead of the first non-empty one.
    let loggedKeys = ''
    const layer = createImageLayer({
      cellSize: () => cellSize(renderer.resolution, renderer.terminalWidth, renderer.terminalHeight, process.env.TWEETER_CELL_PX),
      onReady: () => { renderer.requestRender() }
    })
    renderer.on(CliRenderEvents.FRAME, () => {
      const placements = screen.placements()
      const keys = placements.map((placement) => placement.key).join(',')
      if (keys !== '' && keys !== loggedKeys) {
        loggedKeys = keys
        void debugLogger.log('images.attached', { resolution: renderer.resolution, cell: cellSize(renderer.resolution, renderer.terminalWidth, renderer.terminalHeight, process.env.TWEETER_CELL_PX), placements })
      }
      layer.sync(placements)
    })
    renderer.on(CliRenderEvents.RESIZE, () => { layer.clear() })
    const drop = (): void => { writeToTerminal(kittyDeleteAll()) }
    renderer.on(CliRenderEvents.DESTROY, drop)
    process.once('exit', drop)
  }

  const startOnboarding = (): void => {
    const screen = createOnboardingScreen(renderer, async (credentials) => {
      try {
        const config = await new ConfigStore().upsertProfile(credentials.profileName, {
          authToken: credentials.authToken,
          ct0: credentials.ct0
        })
        const savedProfile = config.profiles[credentials.profileName] ?? {
          authToken: credentials.authToken,
          ct0: credentials.ct0
        }
        screen.destroy()
        await startAuthenticated(config, credentials.profileName, savedProfile)
      } catch (error) {
        screen.setError(errorMessage(error))
      }
    })
  }

  if (!opts.profile) {
    startOnboarding()
    return
  }
  await startAuthenticated(opts.config, opts.profileName ?? opts.config.defaultProfile, opts.profile)
}
