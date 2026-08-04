import { CliRenderEvents, createCliRenderer } from '@opentui/core'
import type { AuthStatus, PostResult } from '../twitter/types.ts'
import { TwitterClient } from '../twitter/client.ts'
import { tweetTextLimit } from '../twitter/constants.ts'
import type { TweeterConfig, TweeterProfile } from '../config/schema.ts'
import { ConfigStore } from '../config/store.ts'
import { beginConversationLoad, clearDetailSelection, enterSelection, failConversationLoad, focusedTweet, initialAppState, leaveSelection, mergeConversationPage, mergeTimelinePage, needsReplies, previewOf, selectFirstReply, selectRelativeDetail, selectRelativeTweet, toggleLightbox, videoOf, type AppState, type FeedId } from '../state/store.ts'
import { createMainScreen } from './mainScreen.ts'
import { errorMessage } from '../utils/result.ts'
import { createDebugLogger } from '../utils/debugLog.ts'
import { createOnboardingScreen } from './onboardingScreen.ts'
import { isCtrlEnterKey, isEnterKey } from './keyEvents.ts'
import { createImageLayer, writeToTerminal, type ImagePlacement } from '../media/imageLayer.ts'
import { cellSize } from '../media/geometry.ts'
import { detectImageRenderer } from '../media/detect.ts'
import { kittyDeleteAll } from '../media/kitty.ts'
import { openExternal, tweetUrl } from '../media/openExternal.ts'

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

    const openPhoto = (source: 'tweet' | 'quote'): void => {
      const focused = focusedTweet(state)
      const tweet = source === 'quote' ? focused?.quotedTweet : focused
      state = toggleLightbox(state, tweet, previewOf(tweet))
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
      onOpenTweet: (tweetId) => { openSelection(tweetId) }
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

    const rerender = (): void => {
      screen.render(state, session.auth)
      scheduleReplies()
    }
    // Pane heights drive the detail row budget, so a resize needs a fresh pass.
    renderer.on(CliRenderEvents.RESIZE, rerender)

    const loadFeed = async (feed: FeedId): Promise<void> => {
      state = { ...state, activeFeed: feed, timelines: { ...state.timelines, [feed]: { ...state.timelines[feed], loading: true, error: undefined } }, status: 'loading feed' }
      rerender()
      try {
        const page = await client.loadHomeTimelinePage({ count: 40, following: feed === 'following', cursor: state.timelines[feed].bottomCursor })
        state = mergeTimelinePage(state, feed, page.tweets, page)
        state = { ...state, status: `loaded ${page.tweets.length} tweets` }
      } catch (error) {
        state = { ...state, status: 'feed error', timelines: { ...state.timelines, [feed]: { ...state.timelines[feed], loading: false, error: errorMessage(error) } } }
      }
      rerender()
    }

    const loadReplies = async (tweetId: string): Promise<void> => {
      const cursor = state.conversations[tweetId]?.cursor
      state = beginConversationLoad(state, tweetId)
      rerender()
      try {
        const page = await client.loadRepliesPage({ tweetId, cursor })
        state = mergeConversationPage(state, tweetId, page.replies, page.cursor)
        // The page also carries the thread above the tweet, so count what the pane keeps.
        state = { ...state, status: `loaded ${state.conversations[tweetId]?.replyIds.length ?? 0} replies` }
      } catch (error) {
        state = failConversationLoad(state, tweetId, errorMessage(error))
      }
      rerender()
    }

    const sendComposer = async (): Promise<void> => {
      const replyToTweetId = state.composer.replyToTweetId
      const text = state.composer.draft.trim()
      if (!replyToTweetId || text === '') {
        return
      }
      // X counts the characters itself, but a local check saves a round trip and keeps
      // the draft in the composer instead of losing it to a server refusal.
      if (text.length > tweetTextLimit) {
        const message = `reply is ${text.length} characters; the limit is ${tweetTextLimit}`
        state = { ...state, composer: { ...state.composer, sending: false, error: message }, status: message }
        rerender()
        return
      }
      state = { ...state, composer: { ...state.composer, sending: true, error: undefined }, status: 'sending reply' }
      rerender()
      await debugLogger.log('ui.reply.submit', { replyToTweetId, textLength: text.length })
      const result: PostResult = await client.replyToTweet({ tweetId: replyToTweetId, text })
      if (result.ok) {
        state = { ...state, composer: { open: false, draft: '', sending: false }, status: `sent reply ${result.tweetId}` }
        rerender()
        return
      }
      await debugLogger.log('ui.reply.failed', { replyToTweetId, error: result.error, status: result.status, code: result.code, logPath: debugLogger.path })
      state = { ...state, composer: { ...state.composer, sending: false, error: `${result.error}\nLog: ${debugLogger.path}` }, status: `reply failed; log: ${debugLogger.path}` }
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
        state = { ...state, composer: { open: false, draft: '', sending: false }, status: 'composer closed' }
        rerender()
        return
      }
      if (state.composer.open) {
        if (isCtrlEnterKey(key) || isEnterKey(key)) {
          void sendComposer()
          return
        }
        if (key.name === 'backspace') {
          state = { ...state, composer: { ...state.composer, draft: state.composer.draft.slice(0, -1) } }
          rerender()
          return
        }
        if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
          state = { ...state, composer: { ...state.composer, draft: `${state.composer.draft}${key.sequence}` } }
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
      // The plain arrows follow the focus: → moves it into the replies, ← hands it back
      // to the feed, and ↑/↓ walk whichever list holds it. j/k always stay on the feed.
      if (key.name === 'right') {
        state = selectFirstReply(state)
        rerender()
        return
      }
      if (key.name === 'left') {
        state = state.selectedDetailId ? clearDetailSelection(state) : leaveSelection(state)
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
        void loadFeed(next)
        return
      }
      // Shift+R arrives as name 'r' with shift set, so refresh must win over the reply composer.
      if (key.name === 'R' || (key.shift && key.name === 'r')) {
        void loadFeed(state.activeFeed)
        return
      }
      if (key.name === 'r' && focusedTweet(state)) {
        state = { ...state, composer: { open: true, replyToTweetId: focusedTweet(state)?.id, draft: '', sending: false }, status: 'reply composer' }
        rerender()
        return
      }
      if (key.name === 'p') {
        const focused = focusedTweet(state)
        if (focused) {
          openPhoto(previewOf(focused) ? 'tweet' : 'quote')
        }
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
    await loadFeed(feed)
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
