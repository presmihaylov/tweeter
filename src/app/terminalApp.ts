import { createCliRenderer } from '@opentui/core'
import type { AuthStatus, PostResult } from '../twitter/types.ts'
import { TwitterClient } from '../twitter/client.ts'
import { OfficialXApiClient } from '../twitter/officialClient.ts'
import type { BirdTuiConfig, BirdTuiProfile, XApiTokens } from '../config/schema.ts'
import { ConfigStore } from '../config/store.ts'
import { initialAppState, mergeConversationPage, mergeTimelinePage, selectRelativeTweet, type AppState, type FeedId } from '../state/store.ts'
import { createMainScreen } from './mainScreen.ts'
import { errorMessage } from '../utils/result.ts'
import { createDebugLogger } from '../utils/debugLog.ts'
import { createOnboardingScreen } from './onboardingScreen.ts'
import { isCtrlEnterKey, isEnterKey } from './keyEvents.ts'

export type TerminalAppOptions = {
  config: BirdTuiConfig
  profileName?: string
  profile?: BirdTuiProfile
  renderer?: 'auto' | 'chafa' | 'kitty' | 'none'
  debugLog?: string
}

export const runTerminalApp = async (opts: TerminalAppOptions): Promise<void> => {
  const renderer = await createCliRenderer({
    screenMode: 'alternate-screen',
    useMouse: true,
    exitOnCtrlC: true,
    targetFps: 30,
    clearOnShutdown: true
  })
  renderer.start()
  const debugLogger = createDebugLogger(opts.debugLog)

  const startAuthenticated = async (config: BirdTuiConfig, profileName: string, profile: BirdTuiProfile): Promise<void> => {
    let state: AppState = initialAppState()
    const session: { auth?: AuthStatus } = {}
    const screen = createMainScreen(renderer)
    const readClient = new TwitterClient({ authToken: profile.authToken, ct0: profile.ct0, cookieHeader: profile.cookieHeader, debugLogger })
    const writeClient = profile.xApi ? createWriteClient(profile.xApi, profileName) : undefined

    const rerender = (): void => {
      screen.render(state, session.auth)
    }

    const loadFeed = async (feed: FeedId): Promise<void> => {
      state = { ...state, activeFeed: feed, timelines: { ...state.timelines, [feed]: { ...state.timelines[feed], loading: true, error: undefined } }, status: 'loading feed' }
      rerender()
      try {
        const page = await readClient.loadHomeTimelinePage({ count: 40, following: feed === 'following', cursor: state.timelines[feed].bottomCursor })
        state = mergeTimelinePage(state, feed, page.tweets, page)
        state = { ...state, status: `loaded ${page.tweets.length} tweets` }
      } catch (error) {
        state = { ...state, status: 'feed error', timelines: { ...state.timelines, [feed]: { ...state.timelines[feed], loading: false, error: errorMessage(error) } } }
      }
      rerender()
    }

    const loadReplies = async (): Promise<void> => {
      if (!state.selectedTweetId) {
        return
      }
      const tweetId = state.selectedTweetId
      state = { ...state, status: 'loading replies' }
      rerender()
      try {
        const page = await readClient.loadRepliesPage({ tweetId, cursor: state.conversations[tweetId]?.cursor })
        state = mergeConversationPage(state, tweetId, page.replies, page.cursor)
        state = { ...state, status: `loaded ${page.replies.length} replies` }
      } catch (error) {
        state = { ...state, status: `reply load error: ${errorMessage(error)}` }
      }
      rerender()
    }

    const sendComposer = async (): Promise<void> => {
      const replyToTweetId = state.composer.replyToTweetId
      const text = state.composer.draft.trim()
      if (!replyToTweetId || text === '') {
        return
      }
      if (!writeClient) {
        const message = 'X API not configured; run `bird auth twitter --client-id <id>` to enable replies'
        state = { ...state, composer: { ...state.composer, sending: false, error: message }, status: message }
        rerender()
        return
      }
      state = { ...state, composer: { ...state.composer, sending: true, error: undefined }, status: 'sending reply' }
      rerender()
      await debugLogger.log('ui.reply.submit', { replyToTweetId, textLength: text.length })
      const result: PostResult = await writeClient.reply({ tweetId: replyToTweetId, text })
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
      if (key.name === 'r' && state.selectedTweetId) {
        state = { ...state, composer: { open: true, replyToTweetId: state.selectedTweetId, draft: '', sending: false }, status: 'reply composer' }
        rerender()
        return
      }
      if (isEnterKey(key)) {
        void loadReplies()
        return
      }
      if (key.name === 'R' || (key.shift && key.name === 'r')) {
        void loadFeed(state.activeFeed)
      }
    })

    state = { ...state, status: `validating ${profileName}` }
    rerender()
    session.auth = await readClient.checkAuth()
    const authText = session.auth.ok ? `auth ok @${session.auth.username}` : session.auth.error
    const writeText = writeClient ? '' : ' · X API not configured (replies disabled, run `bird auth twitter`)'
    state = { ...state, status: `${authText}${writeText}` }
    rerender()
    if (session.auth.ok) {
      await loadFeed(config.ui?.defaultFeed === 'forYou' ? 'forYou' : 'following')
    }
  }

  const createWriteClient = (tokens: XApiTokens, profileName: string): OfficialXApiClient => {
    return new OfficialXApiClient({
      tokens,
      onTokensRefreshed: async (next) => {
        try {
          await new ConfigStore().setXApiTokens(profileName, next)
        } catch (error) {
          await debugLogger.log('xapi.tokensPersistFailed', { error: errorMessage(error) })
        }
      }
    })
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
