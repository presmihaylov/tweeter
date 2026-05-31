import { createCliRenderer, TextRenderable } from '@opentui/core'
import type { AuthStatus } from '../twitter/types.ts'
import { TwitterClient } from '../twitter/client.ts'
import type { BirdTuiConfig, BirdTuiProfile } from '../config/schema.ts'
import { ConfigStore } from '../config/store.ts'
import { initialAppState, mergeConversationPage, mergeTimelinePage, selectRelativeTweet, type AppState, type FeedId } from '../state/store.ts'
import { renderApp } from './renderText.ts'
import { errorMessage } from '../utils/result.ts'
import { appendOnboardingText, backspaceOnboardingField, initialOnboardingForm, nextOnboardingField, renderOnboardingForm, validateOnboardingForm, type OnboardingFormState } from '../auth/onboardingForm.ts'

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
  const rootText = new TextRenderable(renderer, { id: 'bird-root', content: '', width: '100%', height: '100%' })
  renderer.root.add(rootText)
  renderer.start()

  const startAuthenticated = async (config: BirdTuiConfig, profileName: string, profile: BirdTuiProfile): Promise<void> => {
    let state: AppState = initialAppState()
    const session: { auth?: AuthStatus } = {}
    const client = new TwitterClient({ authToken: profile.authToken, ct0: profile.ct0 })

    const rerender = (): void => {
      rootText.content = renderApp(state, session.auth)
      renderer.requestRender()
    }

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

    const loadReplies = async (): Promise<void> => {
      if (!state.selectedTweetId) {
        return
      }
      const tweetId = state.selectedTweetId
      state = { ...state, status: 'loading replies' }
      rerender()
      try {
        const page = await client.loadRepliesPage({ tweetId, cursor: state.conversations[tweetId]?.cursor })
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
      state = { ...state, composer: { ...state.composer, sending: true, error: undefined }, status: 'sending reply' }
      rerender()
      const result = await client.reply({ tweetId: replyToTweetId, text })
      if (result.ok) {
        state = { ...state, composer: { open: false, draft: '', sending: false }, status: `sent reply ${result.tweetId}` }
        rerender()
        return
      }
      state = { ...state, composer: { ...state.composer, sending: false, error: result.error }, status: 'reply failed' }
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
        if (key.ctrl && key.name === 'enter') {
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
      if (key.name === 'enter') {
        void loadReplies()
        return
      }
      if (key.name === 'R' || (key.shift && key.name === 'r')) {
        void loadFeed(state.activeFeed)
      }
    })

    state = { ...state, status: `validating ${profileName}` }
    rerender()
    session.auth = await client.checkAuth()
    state = { ...state, status: session.auth.ok ? `auth ok @${session.auth.username}` : session.auth.error }
    rerender()
    if (session.auth.ok) {
      await loadFeed(config.ui?.defaultFeed === 'forYou' ? 'forYou' : 'following')
    }
  }

  const startOnboarding = (): void => {
    let form: OnboardingFormState = initialOnboardingForm()

    const rerender = (): void => {
      rootText.content = renderOnboardingForm(form)
      renderer.requestRender()
    }

    const submit = async (): Promise<void> => {
      const validated = validateOnboardingForm(form)
      if ('error' in validated) {
        form = { ...form, error: validated.error, focus: validated.focus }
        rerender()
        return
      }
      form = { ...form, saving: true, error: undefined }
      rerender()
      try {
        const config = await new ConfigStore().upsertProfile(validated.profileName, {
          authToken: validated.authToken,
          ct0: validated.ct0
        })
        renderer.keyInput.off('keypress', onKeypress)
        renderer.keyInput.off('paste', onPaste)
        await startAuthenticated(config, validated.profileName, config.profiles[validated.profileName] ?? { authToken: validated.authToken, ct0: validated.ct0 })
      } catch (error) {
        form = { ...form, saving: false, error: errorMessage(error) }
        rerender()
      }
    }

    const onKeypress = (key: Parameters<typeof renderer.keyInput.on<'keypress'>>[1] extends (arg: infer T) => void ? T : never): void => {
      if (key.name === 'q' || key.name === 'escape') {
        renderer.destroy()
        return
      }
      if (key.name === 'tab') {
        form = nextOnboardingField(form, key.shift ? -1 : 1)
        rerender()
        return
      }
      if (key.name === 'enter') {
        if (form.focus === 'ok') {
          void submit()
          return
        }
        form = nextOnboardingField(form, 1)
        rerender()
        return
      }
      if (key.name === 'backspace') {
        form = backspaceOnboardingField(form)
        rerender()
        return
      }
      if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
        form = appendOnboardingText(form, key.sequence)
        rerender()
      }
    }

    const onPaste = (event: Parameters<typeof renderer.keyInput.on<'paste'>>[1] extends (arg: infer T) => void ? T : never): void => {
      form = appendOnboardingText(form, Buffer.from(event.bytes).toString('utf8'))
      rerender()
    }

    renderer.keyInput.on('keypress', onKeypress)
    renderer.keyInput.on('paste', onPaste)
    rerender()
  }

  if (!opts.profile) {
    startOnboarding()
    return
  }
  await startAuthenticated(opts.config, opts.profileName ?? opts.config.defaultProfile, opts.profile)
}
