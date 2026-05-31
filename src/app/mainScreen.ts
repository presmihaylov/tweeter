import { BoxRenderable, TextRenderable, type CliRenderer } from '@opentui/core'
import type { AppState } from '../state/store.ts'
import type { AppTweet, AuthStatus } from '../twitter/types.ts'

export type MainScreen = {
  render(state: AppState, auth?: AuthStatus): void
  destroy(): void
}

export const createMainScreen = (renderer: CliRenderer): MainScreen => {
  const shell = new BoxRenderable(renderer, {
    id: 'main-shell',
    width: '100%',
    height: '100%',
    backgroundColor: '#090d12',
    flexDirection: 'column',
    padding: 1,
    gap: 1
  })

  const header = new BoxRenderable(renderer, {
    id: 'main-header',
    width: '100%',
    height: 3,
    border: true,
    borderStyle: 'rounded',
    borderColor: '#30363d',
    backgroundColor: '#0d1117',
    flexDirection: 'row',
    alignItems: 'center',
    paddingX: 2,
    gap: 2
  })
  const title = new TextRenderable(renderer, {
    id: 'main-title',
    content: 'birdtui',
    fg: '#f0f6fc',
    width: 12,
    height: 1
  })
  const headerMeta = new TextRenderable(renderer, {
    id: 'main-header-meta',
    content: '',
    fg: '#8b949e',
    flexGrow: 1,
    height: 1
  })
  const headerKeys = new TextRenderable(renderer, {
    id: 'main-header-keys',
    content: 'R refresh  Tab feed  j/k move  Enter replies  r reply  q quit',
    fg: '#58a6ff',
    width: 64,
    height: 1
  })
  header.add(title)
  header.add(headerMeta)
  header.add(headerKeys)

  const body = new BoxRenderable(renderer, {
    id: 'main-body',
    width: '100%',
    flexGrow: 1,
    flexDirection: 'row',
    gap: 1
  })

  const rail = new BoxRenderable(renderer, {
    id: 'left-rail',
    width: 18,
    height: '100%',
    border: true,
    borderStyle: 'rounded',
    borderColor: '#30363d',
    backgroundColor: '#0d1117',
    padding: 1,
    flexDirection: 'column',
    gap: 1
  })
  const railTitle = new TextRenderable(renderer, {
    id: 'rail-title',
    content: 'Feeds',
    fg: '#f0f6fc',
    width: '100%',
    height: 1
  })
  const railFeeds = new TextRenderable(renderer, {
    id: 'rail-feeds',
    content: '',
    fg: '#8b949e',
    width: '100%',
    height: 5
  })
  const railProfile = new TextRenderable(renderer, {
    id: 'rail-profile',
    content: '',
    fg: '#7d8590',
    width: '100%',
    flexGrow: 1,
    wrapMode: 'word'
  })
  rail.add(railTitle)
  rail.add(railFeeds)
  rail.add(railProfile)

  const timelinePane = new BoxRenderable(renderer, {
    id: 'timeline-pane',
    width: 58,
    height: '100%',
    border: true,
    borderStyle: 'rounded',
    borderColor: '#30363d',
    backgroundColor: '#0d1117',
    padding: 1,
    flexDirection: 'column',
    gap: 1
  })
  const timelineHeader = new TextRenderable(renderer, {
    id: 'timeline-header',
    content: 'Timeline',
    fg: '#f0f6fc',
    width: '100%',
    height: 1
  })
  const timelineCards = new BoxRenderable(renderer, {
    id: 'timeline-cards',
    width: '100%',
    flexGrow: 1,
    flexDirection: 'column',
    gap: 1
  })
  timelinePane.add(timelineHeader)
  timelinePane.add(timelineCards)

  const detailPane = new BoxRenderable(renderer, {
    id: 'detail-pane',
    flexGrow: 1,
    height: '100%',
    border: true,
    borderStyle: 'rounded',
    borderColor: '#30363d',
    backgroundColor: '#0d1117',
    padding: 1,
    flexDirection: 'column',
    gap: 1
  })
  const detailHeader = new TextRenderable(renderer, {
    id: 'detail-header',
    content: 'Selected tweet',
    fg: '#f0f6fc',
    width: '100%',
    height: 1
  })
  const detailText = new TextRenderable(renderer, {
    id: 'detail-text',
    content: '',
    fg: '#c9d1d9',
    width: '100%',
    height: 10,
    wrapMode: 'word'
  })
  const mediaText = new TextRenderable(renderer, {
    id: 'detail-media',
    content: '',
    fg: '#d29922',
    width: '100%',
    height: 4,
    wrapMode: 'word'
  })
  const repliesHeader = new TextRenderable(renderer, {
    id: 'replies-header',
    content: 'Replies',
    fg: '#f0f6fc',
    width: '100%',
    height: 1
  })
  const repliesText = new TextRenderable(renderer, {
    id: 'replies-text',
    content: '',
    fg: '#8b949e',
    width: '100%',
    flexGrow: 1,
    wrapMode: 'word'
  })
  detailPane.add(detailHeader)
  detailPane.add(detailText)
  detailPane.add(mediaText)
  detailPane.add(repliesHeader)
  detailPane.add(repliesText)

  body.add(rail)
  body.add(timelinePane)
  body.add(detailPane)

  const composer = new BoxRenderable(renderer, {
    id: 'composer-drawer',
    width: '100%',
    height: 6,
    border: true,
    borderStyle: 'rounded',
    borderColor: '#58a6ff',
    backgroundColor: '#111b2b',
    padding: 1,
    flexDirection: 'column'
  })
  const composerTitle = new TextRenderable(renderer, {
    id: 'composer-title',
    content: '',
    fg: '#58a6ff',
    width: '100%',
    height: 1
  })
  const composerText = new TextRenderable(renderer, {
    id: 'composer-text',
    content: '',
    fg: '#f0f6fc',
    width: '100%',
    flexGrow: 1,
    wrapMode: 'word'
  })
  composer.add(composerTitle)
  composer.add(composerText)

  const status = new BoxRenderable(renderer, {
    id: 'status-bar',
    width: '100%',
    height: 3,
    border: true,
    borderStyle: 'rounded',
    borderColor: '#30363d',
    backgroundColor: '#0d1117',
    paddingX: 2,
    alignItems: 'center'
  })
  const statusText = new TextRenderable(renderer, {
    id: 'status-text',
    content: '',
    fg: '#7d8590',
    width: '100%',
    height: 1
  })
  status.add(statusText)

  shell.add(header)
  shell.add(body)
  shell.add(composer)
  shell.add(status)
  renderer.root.add(shell)

  let cards: BoxRenderable[] = []

  const clearCards = (): void => {
    for (const card of cards) {
      timelineCards.remove(card.id)
      card.destroyRecursively()
    }
    cards = []
  }

  const renderCards = (state: AppState): void => {
    clearCards()
    const timeline = state.timelines[state.activeFeed]
    const visibleIds = timeline.tweetIds.slice(0, 8)
    if (visibleIds.length === 0) {
      const empty = cardBox(renderer, 'timeline-empty', false)
      empty.add(new TextRenderable(renderer, {
        id: 'timeline-empty-text',
        content: timeline.loading ? 'Loading feed…' : 'No tweets loaded yet.',
        fg: '#8b949e',
        width: '100%',
        height: 1
      }))
      timelineCards.add(empty)
      cards.push(empty)
      return
    }
    for (const id of visibleIds) {
      const tweet = state.tweets[id]
      if (!tweet) {
        continue
      }
      const selected = id === state.selectedTweetId
      const card = cardBox(renderer, `tweet-card-${id}`, selected)
      const mediaPill = tweet.media.length > 0 ? `  ${tweet.media.map((item) => item.type === 'photo' ? 'image' : item.type).join(' · ')}` : ''
      card.add(new TextRenderable(renderer, {
        id: `tweet-card-${id}-author`,
        content: `@${tweet.author.handle}  ${tweet.author.name}${mediaPill}`,
        fg: selected ? '#58a6ff' : '#f0f6fc',
        width: '100%',
        height: 1,
        truncate: true
      }))
      card.add(new TextRenderable(renderer, {
        id: `tweet-card-${id}-body`,
        content: tweet.text.replaceAll('\n', ' '),
        fg: '#c9d1d9',
        width: '100%',
        height: 2,
        wrapMode: 'word'
      }))
      card.add(new TextRenderable(renderer, {
        id: `tweet-card-${id}-metrics`,
        content: `${tweet.metrics.replies ?? 0} replies   ${tweet.metrics.reposts ?? 0} reposts   ${tweet.metrics.likes ?? 0} likes`,
        fg: '#7d8590',
        width: '100%',
        height: 1
      }))
      timelineCards.add(card)
      cards.push(card)
    }
  }

  return {
    render(state: AppState, auth?: AuthStatus) {
      const selected = state.selectedTweetId ? state.tweets[state.selectedTweetId] : undefined
      const timeline = state.timelines[state.activeFeed]
      headerMeta.content = `${auth?.ok ? `@${auth.username}` : 'auth pending'} · ${state.activeFeed === 'following' ? 'Following' : 'For You'}`
      railFeeds.content = `${state.activeFeed === 'following' ? '●' : '○'} Following\n${state.activeFeed === 'forYou' ? '●' : '○'} For You\n\nTab switches`
      railProfile.content = auth?.ok ? `Signed in\n@${auth.username}\n\n${auth.name ?? ''}` : 'Checking credentials…'
      timelineHeader.content = `${state.activeFeed === 'following' ? 'Following' : 'For You'} · ${timeline.tweetIds.length} tweets`
      detailHeader.content = selected ? `@${selected.author.handle}` : 'Selected tweet'
      detailText.content = selected ? detailContent(selected) : 'Select a tweet with j/k.'
      mediaText.content = selected && selected.media.length > 0 ? selected.media.map(formatMedia).join('\n') : 'No media for selected tweet.'
      const conversation = selected ? state.conversations[selected.id] : undefined
      repliesHeader.content = `Replies${conversation ? ` · ${conversation.replyIds.length}` : ''}`
      repliesText.content = conversation ? conversation.replyIds.slice(0, 8).map((replyId) => {
        const reply = state.tweets[replyId]
        return reply ? `@${reply.author.handle}: ${reply.text.replaceAll('\n', ' ')}` : ''
      }).filter(Boolean).join('\n\n') : 'Press Enter to load replies.'
      composer.visible = state.composer.open
      composerTitle.content = `Replying to ${state.composer.replyToTweetId ?? 'tweet'} · Ctrl+Enter send · Esc close`
      composerText.content = state.composer.draft || 'Start typing…'
      statusText.content = state.status
      statusText.fg = state.status.includes('error') || state.status.includes('failed') ? '#ff7b72' : '#7d8590'
      renderCards(state)
      renderer.requestRender()
    },
    destroy() {
      clearCards()
      renderer.root.remove(shell.id)
      shell.destroyRecursively()
      renderer.requestRender()
    }
  }
}

const cardBox = (renderer: CliRenderer, id: string, selected: boolean): BoxRenderable => {
  return new BoxRenderable(renderer, {
    id,
    width: '100%',
    height: 6,
    border: true,
    borderStyle: 'rounded',
    borderColor: selected ? '#58a6ff' : '#30363d',
    backgroundColor: selected ? '#111b2b' : '#0d1117',
    paddingX: 1,
    flexDirection: 'column'
  })
}

const detailContent = (tweet: AppTweet): string => {
  return [
    `${tweet.author.name} @${tweet.author.handle}`,
    '',
    tweet.text,
    '',
    `${tweet.metrics.replies ?? 0} replies · ${tweet.metrics.reposts ?? 0} reposts · ${tweet.metrics.likes ?? 0} likes · ${tweet.metrics.views ?? 0} views`
  ].join('\n')
}

const formatMedia = (media: AppTweet['media'][number]): string => {
  const url = media.type === 'photo' ? media.url : media.videoUrl ?? media.url
  return `${media.type}: ${url}`
}
