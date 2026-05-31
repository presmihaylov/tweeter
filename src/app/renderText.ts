import type { AuthStatus } from '../twitter/types.ts'
import type { AppState } from '../state/store.ts'
import { onboardingText } from '../auth/onboarding.ts'

export const renderOnboarding = (): string => onboardingText()

export const renderApp = (state: AppState, auth?: AuthStatus): string => {
  const timeline = state.timelines[state.activeFeed]
  const selected = state.selectedTweetId ? state.tweets[state.selectedTweetId] : undefined
  const lines: string[] = []
  lines.push('birdtui  R refresh  Tab feed  j/k move  Enter replies  r reply  q quit')
  lines.push(`profile: ${auth?.ok ? `@${auth.username}` : 'checking'}  feed: ${state.activeFeed === 'following' ? 'Following' : 'For You'}  status: ${state.status}`)
  lines.push('')
  lines.push('TIMELINE')
  if (timeline.loading) {
    lines.push('  loading...')
  }
  if (timeline.error) {
    lines.push(`  error: ${timeline.error}`)
  }
  if (timeline.tweetIds.length === 0 && !timeline.loading) {
    lines.push('  no tweets loaded')
  }
  for (const id of timeline.tweetIds.slice(0, 20)) {
    const tweet = state.tweets[id]
    if (!tweet) {
      continue
    }
    const marker = id === state.selectedTweetId ? '>' : ' '
    const media = tweet.media.length > 0 ? ` [${tweet.media.map((item) => item.type).join(',')}]` : ''
    lines.push(`${marker} @${tweet.author.handle} · ${tweet.metrics.likes ?? 0} likes${media}`)
    lines.push(`  ${tweet.text.replaceAll('\n', ' ').slice(0, 120)}`)
  }
  lines.push('')
  lines.push('DETAIL')
  if (selected) {
    lines.push(`@${selected.author.handle} (${selected.author.name})`)
    lines.push(selected.text)
    lines.push(`metrics: ${selected.metrics.replies ?? 0} replies · ${selected.metrics.reposts ?? 0} reposts · ${selected.metrics.likes ?? 0} likes`)
    for (const media of selected.media) {
      const url = media.type === 'photo' ? media.url : media.videoUrl ?? media.url
      lines.push(`media ${media.type}: ${url}`)
    }
    const conversation = state.conversations[selected.id]
    if (conversation) {
      lines.push('')
      lines.push(`REPLIES (${conversation.replyIds.length})`)
      for (const replyId of conversation.replyIds.slice(0, 8)) {
        const reply = state.tweets[replyId]
        if (reply) {
          lines.push(`- @${reply.author.handle}: ${reply.text.replaceAll('\n', ' ').slice(0, 100)}`)
        }
      }
    }
  }
  if (state.composer.open) {
    lines.push('')
    lines.push(`COMPOSER replying to ${state.composer.replyToTweetId ?? 'new tweet'}`)
    lines.push(state.composer.draft || '(type reply text, Ctrl+Enter sends, Esc closes)')
    if (state.composer.error) {
      lines.push(`composer error: ${state.composer.error}`)
    }
  }
  return lines.join('\n')
}
