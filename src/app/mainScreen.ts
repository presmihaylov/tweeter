import { BoxRenderable, StyledText, TextRenderable, fg, stringToStyledText, type CliRenderer, type Renderable, type TextChunk } from '@opentui/core'
import { focusedTweet, parentIdOf, previewOf, replyIdsOf, type AppState, type ConversationState } from '../state/store.ts'
import type { AppMedia, AppTweet, AuthStatus } from '../twitter/types.ts'
import { tweetTextLimit } from '../twitter/constants.ts'
import type { CellSize, ImagePlacement } from '../media/imageLayer.ts'
import { cellSize, fitCells } from '../media/geometry.ts'

export type MainScreen = {
  render(state: AppState, auth?: AuthStatus): void
  placements(): ImagePlacement[]
  scrollDetail(delta: number): void
  destroy(): void
}

export type MainScreenOptions = {
  onOpenPhoto?: (source: 'tweet' | 'quote') => void
  onCloseLightbox?: () => void
  onOpenQuote?: () => void
  onOpenTweet?: (tweetId: string) => void
}

// Reserved cells; toPlacement shrinks this to the largest square the font metrics allow.
const avatarCols = 7
const avatarRows = 3
const cardHeight = 6
// Border rows plus the author line and two text rows next to the avatar.
const quoteRows = avatarRows + 2
const parentRows = avatarRows + 2
const quotePhotoRows = 4
const detailTextCap = 12
const detailTextFloor = 3
// A reply card carries the same four lines as a timeline card, so the replies floor is
// one whole card.
const replyCardHeight = cardHeight
const repliesFloor = replyCardHeight
const mediaFloor = 3

const mediaCap = 12

export type DetailLayout = { parent: number; text: number; media: number; quote: number; replies: number }

// Flex alone let the quote card eat the photo's rows, so the detail pane divides them
// itself. Order of claim: the parent card, the quote card text, the tweet text, the
// quoted photo, the tweet photo, then the replies. Anything under mediaFloor draws as a
// useless sliver, so those rows go back to the replies instead.
export const detailLayout = (paneHeight: number, opts: { photo: boolean; quote: boolean; quotePhoto: boolean; parent: boolean; textLines: number }): DetailLayout => {
  if (paneHeight < 1) {
    return { parent: 0, text: detailTextFloor, media: 0, quote: 0, replies: repliesFloor }
  }
  const boxes = 6 + (opts.photo ? 1 : 0) + (opts.quote ? 1 : 0) + (opts.parent ? 1 : 0)
  // The border and padding take 4 rows. The author row, the caption, the replies header
  // and the metrics bar take 6 more between them.
  const body = Math.max(0, paneHeight - 4 - (boxes - 1) - 6)
  // The parent card is what the open tweet answers, so it is read before anything else.
  const parent = opts.parent ? Math.min(body, parentRows) : 0
  const quoteBase = opts.quote ? Math.min(body - parent, quoteRows) : 0
  // A short tweet gives its spare rows to the photo; a long one scrolls at the cap.
  const wanted = Math.min(detailTextCap, Math.max(detailTextFloor, opts.textLines))
  const text = Math.max(0, Math.min(wanted, body - parent - quoteBase))
  const rest = Math.max(0, body - parent - quoteBase - text)
  const quoteWanted = opts.quote && opts.quotePhoto
    ? Math.min(quotePhotoRows, Math.max(0, rest - repliesFloor - (opts.photo ? mediaFloor : 0)))
    : 0
  const quoteExtra = quoteWanted < mediaFloor ? 0 : quoteWanted
  const free = rest - quoteExtra
  // The replies keep their floor whenever the pane can pay for both, but a photo that
  // fits beside a single reply row still beats no photo at all.
  const media = !opts.photo || free - 1 < mediaFloor ? 0 : Math.min(mediaCap, Math.max(mediaFloor, free - repliesFloor))
  return { parent, text, media, quote: quoteBase + quoteExtra, replies: free - media }
}

const namedEntities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

// X returns tweet text with the HTML entities still escaped, so a quoted ">" arrives
// as "&gt;" and would otherwise reach the screen that way.
export const decodeEntities = (text: string): string =>
  text.replace(/&(amp|lt|gt|quot|apos|nbsp|#\d+);/g, (match, name: string) => {
    if (!name.startsWith('#')) {
      return namedEntities[name] ?? match
    }
    const code = Number.parseInt(name.slice(1), 10)
    return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : match
  })

// Wraps on word boundaries and keeps the tweet's own blank lines, so paragraphs survive.
export const wrapText = (text: string, width: number): string[] => {
  if (width < 1) {
    return text.split('\n')
  }
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    const before = lines.length
    let line = ''
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      // A link longer than the pane has to be cut, or the whole line disappears.
      if (word.length > width) {
        if (line !== '') {
          lines.push(line)
          line = ''
        }
        for (let start = 0; start < word.length; start += width) {
          lines.push(word.slice(start, start + width))
        }
        continue
      }
      const next = line === '' ? word : `${line} ${word}`
      if (next.length > width) {
        lines.push(line)
        line = word
        continue
      }
      line = next
    }
    // An empty tail only belongs on the screen when the author typed a blank line.
    if (line !== '' || lines.length === before) {
      lines.push(line)
    }
  }
  return lines
}

// The last page spends a row on the "more above" marker, so it starts one line lower
// than a plain slice would allow.
export const clampScroll = (top: number, total: number, rows: number): number =>
  Math.max(0, Math.min(top, total <= rows ? 0 : total - rows + 1))

export type DetailBlock = { above?: string; lines: string[]; below?: string }

// A cut tweet has to say so inside the text itself, not only in the hint line, so the
// block spends a row on a marker at each edge that still hides text.
export const detailBlock = (lines: string[], top: number, rows: number): DetailBlock => {
  if (rows < 1) {
    return { lines: [] }
  }
  if (lines.length <= rows) {
    return { lines: lines.slice(0, rows) }
  }
  const above = top > 0
  const room = Math.max(0, rows - (above ? 1 : 0))
  const size = top + room < lines.length ? Math.max(0, room - 1) : room
  const hidden = lines.length - top - size
  return {
    above: above ? `▴ ${top} more above · Ctrl+W` : undefined,
    lines: lines.slice(top, top + size),
    below: hidden > 0 ? `▾ ${hidden} more below · Ctrl+S` : undefined
  }
}

// The markers are blue so the eye separates them from the tweet, which forces one
// StyledText instead of the plain string the rest of the pane uses.
const blockContent = (block: DetailBlock): StyledText => {
  const marker = fg('#58a6ff')
  const chunks: TextChunk[] = []
  if (block.above !== undefined) {
    chunks.push(marker(block.above))
  }
  if (block.lines.length > 0) {
    chunks.push(...stringToStyledText(`${chunks.length > 0 ? '\n' : ''}${block.lines.join('\n')}`).chunks)
  }
  if (block.below !== undefined) {
    chunks.push(marker(`${chunks.length > 0 ? '\n' : ''}${block.below}`))
  }
  return new StyledText(chunks)
}

// Cards sit in a column with a one-row gap, so n cards need cardHeight*n + n-1 rows.
// A height of 0 means the pane has not been laid out yet; assume the old fixed page.
export const cardCapacity = (paneHeight: number): number => {
  if (paneHeight < 1) {
    return 8
  }
  return Math.max(1, Math.floor((paneHeight + 1) / (cardHeight + 1)))
}

export const replyCapacity = (paneHeight: number): number =>
  paneHeight < 1 ? 1 : Math.max(1, Math.floor((paneHeight + 1) / (replyCardHeight + 1)))

// Scrolls by the smallest amount that brings the selected card back into the page.
export const scrollWindow = (total: number, selectedIndex: number, capacity: number, top: number): number => {
  const maxTop = Math.max(0, total - capacity)
  const clamped = Math.max(0, Math.min(top, maxTop))
  if (selectedIndex < 0) {
    return clamped
  }
  if (selectedIndex < clamped) {
    return selectedIndex
  }
  if (selectedIndex > clamped + capacity - 1) {
    return Math.min(maxTop, selectedIndex - capacity + 1)
  }
  return clamped
}

type ImageSlot = {
  key: string
  url: string
  box: BoxRenderable
  pane: BoxRenderable
  width?: number
  height?: number
  minCols?: number
  minRows?: number
}

export const createMainScreen = (renderer: CliRenderer, opts: MainScreenOptions = {}): MainScreen => {
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
    content: 'tweeter',
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
    content: 'R refresh  Tab feed  j/k feed  ←/→ focus  ↑/↓ move  Shift+→ open  Enter more  p photo  v video  o open  q quit',
    fg: '#58a6ff',
    width: 110,
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
    flexShrink: 1,
    minHeight: 0,
    overflow: 'hidden',
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
  // x.com puts the answered tweet above the reply, so the reader sees what the reply
  // talks about. The card is a target of its own: Shift+↑ picks it, a click opens it.
  const parentBox = new BoxRenderable(renderer, {
    id: 'detail-parent',
    width: '100%',
    height: parentRows,
    flexShrink: 0,
    border: true,
    borderStyle: 'rounded',
    borderColor: '#30363d',
    backgroundColor: '#0d1117',
    paddingX: 1,
    flexDirection: 'row',
    gap: 1
  })
  const parentAvatar = new BoxRenderable(renderer, {
    id: 'detail-parent-avatar',
    width: avatarCols,
    height: avatarRows
  })
  const parentColumn = new BoxRenderable(renderer, {
    id: 'detail-parent-column',
    flexGrow: 1,
    height: '100%',
    flexDirection: 'column'
  })
  const parentAuthor = new TextRenderable(renderer, {
    id: 'detail-parent-author',
    content: '',
    fg: '#f0f6fc',
    width: '100%',
    height: 1,
    truncate: true
  })
  const parentText = new TextRenderable(renderer, {
    id: 'detail-parent-text',
    content: '',
    fg: '#c9d1d9',
    width: '100%',
    height: 2,
    wrapMode: 'word'
  })
  parentColumn.add(parentAuthor)
  parentColumn.add(parentText)
  parentBox.add(parentAvatar)
  parentBox.add(parentColumn)
  // The author sits above the text with a round avatar, the way x.com opens a post.
  const detailAuthorRow = new BoxRenderable(renderer, {
    id: 'detail-author-row',
    width: '100%',
    height: avatarRows,
    flexShrink: 0,
    flexDirection: 'row',
    gap: 1
  })
  const detailAvatar = new BoxRenderable(renderer, {
    id: 'detail-avatar',
    width: avatarCols,
    height: avatarRows
  })
  const detailAuthorColumn = new BoxRenderable(renderer, {
    id: 'detail-author-column',
    flexGrow: 1,
    height: '100%',
    flexDirection: 'column'
  })
  const detailAuthorName = new TextRenderable(renderer, {
    id: 'detail-author-name',
    content: '',
    fg: '#f0f6fc',
    width: '100%',
    height: 1,
    truncate: true
  })
  const detailAuthorHandle = new TextRenderable(renderer, {
    id: 'detail-author-handle',
    content: '',
    fg: '#7d8590',
    width: '100%',
    height: 1,
    truncate: true
  })
  // The avatar is three rows tall, so the third line is free. The navigation and scroll
  // hints live there instead of on a title bar that repeated the handle.
  const detailHints = new TextRenderable(renderer, {
    id: 'detail-hints',
    content: '',
    fg: '#58a6ff',
    width: '100%',
    height: 1,
    truncate: true
  })
  detailAuthorColumn.add(detailAuthorName)
  detailAuthorColumn.add(detailAuthorHandle)
  detailAuthorColumn.add(detailHints)
  detailAuthorRow.add(detailAvatar)
  detailAuthorRow.add(detailAuthorColumn)
  // The text is wrapped and sliced here rather than by the renderable, because a
  // wrapMode box cannot be scrolled.
  const detailText = new TextRenderable(renderer, {
    id: 'detail-text',
    content: '',
    fg: '#c9d1d9',
    width: '100%',
    height: detailTextFloor
  })
  const mediaText = new TextRenderable(renderer, {
    id: 'detail-media',
    content: '',
    fg: '#d29922',
    width: '100%',
    height: 1,
    truncate: true
  })
  const mediaBox = new BoxRenderable(renderer, {
    id: 'detail-media-image',
    width: '100%',
    height: 0,
    flexShrink: 0,
    flexDirection: 'column'
  })
  // The quoted tweet is its own bordered card, the way x.com nests it inside the post.
  const quoteBox = new BoxRenderable(renderer, {
    id: 'detail-quote',
    width: '100%',
    height: quoteRows,
    flexShrink: 0,
    border: true,
    borderStyle: 'rounded',
    borderColor: '#30363d',
    backgroundColor: '#0d1117',
    paddingX: 1,
    flexDirection: 'column'
  })
  const quoteRow = new BoxRenderable(renderer, {
    id: 'detail-quote-row',
    width: '100%',
    height: avatarRows,
    flexShrink: 0,
    flexDirection: 'row',
    gap: 1
  })
  const quoteAvatar = new BoxRenderable(renderer, {
    id: 'detail-quote-avatar',
    width: avatarCols,
    height: avatarRows
  })
  const quoteColumn = new BoxRenderable(renderer, {
    id: 'detail-quote-column',
    flexGrow: 1,
    height: '100%',
    flexDirection: 'column'
  })
  const quoteAuthor = new TextRenderable(renderer, {
    id: 'detail-quote-author',
    content: '',
    fg: '#f0f6fc',
    width: '100%',
    height: 1,
    truncate: true
  })
  const quoteText = new TextRenderable(renderer, {
    id: 'detail-quote-text',
    content: '',
    fg: '#c9d1d9',
    width: '100%',
    height: 2,
    wrapMode: 'word'
  })
  const quoteMediaBox = new BoxRenderable(renderer, {
    id: 'detail-quote-image',
    width: '100%',
    flexGrow: 1,
    minHeight: 0
  })
  quoteColumn.add(quoteAuthor)
  quoteColumn.add(quoteText)
  quoteRow.add(quoteAvatar)
  quoteRow.add(quoteColumn)
  quoteBox.add(quoteRow)
  quoteBox.add(quoteMediaBox)

  const repliesHeader = new TextRenderable(renderer, {
    id: 'replies-header',
    content: 'Replies',
    fg: '#f0f6fc',
    width: '100%',
    height: 1
  })
  // The replies are cards with avatars, like the timeline, so the same eye reads both.
  const repliesList = new BoxRenderable(renderer, {
    id: 'replies-list',
    width: '100%',
    height: replyCardHeight,
    overflow: 'hidden',
    flexDirection: 'column',
    gap: 1
  })
  // Anchored last so the counts always sit on the bottom row of the pane.
  const detailMetrics = new TextRenderable(renderer, {
    id: 'detail-metrics',
    content: '',
    fg: '#7d8590',
    width: '100%',
    height: 1,
    flexShrink: 0,
    truncate: true
  })
  detailPane.add(parentBox)
  detailPane.add(detailAuthorRow)
  detailPane.add(detailText)
  detailPane.add(mediaText)
  detailPane.add(mediaBox)
  detailPane.add(quoteBox)
  detailPane.add(repliesHeader)
  detailPane.add(repliesList)
  detailPane.add(detailMetrics)

  body.add(rail)
  body.add(timelinePane)
  body.add(detailPane)

  // The lightbox replaces the body instead of floating over it, so the hidden panes
  // drop their own image placements and cannot bleed through the enlarged photo.
  const lightbox = new BoxRenderable(renderer, {
    id: 'lightbox',
    width: '100%',
    flexGrow: 1,
    border: true,
    borderStyle: 'rounded',
    borderColor: '#58a6ff',
    backgroundColor: '#010409',
    padding: 1,
    flexDirection: 'column',
    gap: 1
  })
  const lightboxCaption = new TextRenderable(renderer, {
    id: 'lightbox-caption',
    content: '',
    fg: '#58a6ff',
    width: '100%',
    height: 1,
    truncate: true
  })
  const lightboxImage = new BoxRenderable(renderer, {
    id: 'lightbox-image',
    width: '100%',
    flexGrow: 1
  })
  lightbox.add(lightboxCaption)
  lightbox.add(lightboxImage)
  lightbox.onMouseDown = () => { opts.onCloseLightbox?.() }
  mediaBox.onMouseDown = () => { opts.onOpenPhoto?.('tweet') }
  quoteBox.onMouseDown = () => { opts.onOpenQuote?.() }
  // A click lands on the deepest box first and then bubbles, so the quoted photo must
  // stop here. Otherwise one click both enlarges the photo and opens the quote.
  quoteMediaBox.onMouseDown = (event) => {
    event.stopPropagation()
    opts.onOpenPhoto?.('quote')
  }

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
  shell.add(lightbox)
  shell.add(composer)
  shell.add(status)
  renderer.root.add(shell)

  let cards: BoxRenderable[] = []
  let slots: ImageSlot[] = []
  let replyCards: Renderable[] = []
  let replySlots: ImageSlot[] = []
  let replyTop = 0
  let mediaSlot: ImageSlot | undefined
  let parentAvatarSlot: ImageSlot | undefined
  let quoteAvatarSlot: ImageSlot | undefined
  let quoteMediaSlot: ImageSlot | undefined
  let detailAvatarSlot: ImageSlot | undefined
  let lightboxSlot: ImageSlot | undefined
  let scrollTop = 0
  let detailScroll = 0
  let detailLines: string[] = []
  let detailTweetId: string | undefined

  const clearCards = (): void => {
    for (const card of cards) {
      timelineCards.remove(card.id)
      card.destroyRecursively()
    }
    cards = []
  }

  const clearReplyCards = (): void => {
    for (const card of replyCards) {
      repliesList.remove(card.id)
      card.destroyRecursively()
    }
    replyCards = []
  }

  const renderReplyCards = (state: AppState, rows: number): void => {
    clearReplyCards()
    replySlots = []
    const ids = replyIdsOf(state)
    const conversation = focusedTweet(state) ? state.conversations[focusedTweet(state)?.id ?? ''] : undefined
    if (ids.length === 0) {
      const empty = new TextRenderable(renderer, {
        id: 'replies-empty',
        content: repliesEmpty(conversation),
        fg: '#8b949e',
        width: '100%',
        height: 1
      })
      repliesList.add(empty)
      replyCards.push(empty)
      return
    }
    const capacity = replyCapacity(rows)
    replyTop = scrollWindow(ids.length, ids.indexOf(state.selectedDetailId ?? ''), capacity, replyTop)
    for (const id of ids.slice(replyTop, replyTop + capacity)) {
      const reply = state.tweets[id]
      if (!reply) {
        continue
      }
      const selected = id === state.selectedDetailId
      const card = cardBox(renderer, `reply-card-${id}`, selected)
      const avatar = new BoxRenderable(renderer, { id: `reply-card-${id}-avatar`, width: avatarCols, height: avatarRows })
      const column = new BoxRenderable(renderer, { id: `reply-card-${id}-column`, flexGrow: 1, height: '100%', flexDirection: 'column' })
      column.add(new TextRenderable(renderer, {
        id: `reply-card-${id}-author`,
        content: `${repostPill(reply)}${reply.author.name}${reply.author.verified ? ' ✔' : ''}  @${reply.author.handle}${reply.quotedTweet ? '  quote' : ''}`,
        fg: selected ? '#58a6ff' : '#f0f6fc',
        width: '100%',
        height: 1,
        truncate: true
      }))
      column.add(new TextRenderable(renderer, {
        id: `reply-card-${id}-body`,
        content: decodeEntities(reply.text).replaceAll('\n', ' '),
        fg: '#c9d1d9',
        width: '100%',
        height: 2,
        wrapMode: 'word'
      }))
      column.add(new TextRenderable(renderer, {
        id: `reply-card-${id}-metrics`,
        content: cardMetrics(reply),
        fg: '#7d8590',
        width: '100%',
        height: 1,
        truncate: true
      }))
      card.add(avatar)
      card.add(column)
      card.onMouseDown = () => { opts.onOpenTweet?.(id) }
      repliesList.add(card)
      replyCards.push(card)
      if (reply.author.avatarUrl) {
        replySlots.push({ key: `avatar:reply:${id}`, url: reply.author.avatarUrl, box: avatar, pane: repliesList, width: 1, height: 1, minCols: avatarCols, minRows: avatarRows })
      }
    }
  }

  const renderCards = (state: AppState): void => {
    clearCards()
    slots = []
    const timeline = state.timelines[state.activeFeed]
    const capacity = cardCapacity(timelineCards.height)
    scrollTop = scrollWindow(timeline.tweetIds.length, timeline.tweetIds.indexOf(state.selectedTweetId ?? ''), capacity, scrollTop)
    const visibleIds = timeline.tweetIds.slice(scrollTop, scrollTop + capacity)
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
      const avatar = new BoxRenderable(renderer, {
        id: `tweet-card-${id}-avatar`,
        width: avatarCols,
        height: avatarRows
      })
      const column = new BoxRenderable(renderer, {
        id: `tweet-card-${id}-column`,
        flexGrow: 1,
        height: '100%',
        flexDirection: 'column'
      })
      const mediaPill = tweet.media.length > 0 ? `  ${tweet.media.map((item) => item.type === 'photo' ? 'image' : item.type).join(' · ')}` : ''
      column.add(new TextRenderable(renderer, {
        id: `tweet-card-${id}-author`,
        content: `${repostPill(tweet)}${tweet.author.name}${tweet.author.verified ? ' ✔' : ''}  @${tweet.author.handle}${mediaPill}`,
        fg: selected ? '#58a6ff' : '#f0f6fc',
        width: '100%',
        height: 1,
        truncate: true
      }))
      column.add(new TextRenderable(renderer, {
        id: `tweet-card-${id}-body`,
        content: decodeEntities(tweet.text).replaceAll('\n', ' '),
        fg: '#c9d1d9',
        width: '100%',
        height: 2,
        wrapMode: 'word'
      }))
      column.add(new TextRenderable(renderer, {
        id: `tweet-card-${id}-metrics`,
        content: cardMetrics(tweet),
        fg: '#7d8590',
        width: '100%',
        height: 1
      }))
      card.add(avatar)
      card.add(column)
      timelineCards.add(card)
      cards.push(card)
      if (tweet.author.avatarUrl) {
        slots.push({ key: `avatar:${id}`, url: tweet.author.avatarUrl, box: avatar, pane: timelineCards, width: 1, height: 1, minCols: avatarCols, minRows: avatarRows })
      }
    }
  }

  return {
    render(state: AppState, auth?: AuthStatus) {
      const focused = focusedTweet(state)
      const timeline = state.timelines[state.activeFeed]
      body.visible = state.lightbox === undefined
      lightbox.visible = state.lightbox !== undefined
      lightboxCaption.content = state.lightbox ? `${state.lightbox.label} · click or Esc to close` : ''
      lightboxSlot = state.lightbox
        ? { key: state.lightbox.key, url: state.lightbox.url, box: lightboxImage, pane: lightbox, width: state.lightbox.width, height: state.lightbox.height, minRows: mediaFloor }
        : undefined
      // X retired the v1.1 account endpoints, so a cookie session cannot resolve its own handle.
      const handle = auth?.ok && auth.username ? `@${auth.username}` : 'cookie session'
      headerMeta.content = `${auth?.ok ? handle : 'auth pending'} · ${state.activeFeed === 'following' ? 'Following' : 'For You'}`
      railFeeds.content = `${state.activeFeed === 'following' ? '●' : '○'} Following\n${state.activeFeed === 'forYou' ? '●' : '○'} For You\n\nTab switches`
      railProfile.content = auth?.ok ? `Signed in\n${handle}\n\n${auth.name ?? ''}` : 'Checking credentials…'
      timelineHeader.content = `${state.activeFeed === 'following' ? 'Following' : 'For You'} · ${timeline.tweetIds.length} tweets`
      // A new tweet always starts at its first line, never at the old offset.
      if (focused?.id !== detailTweetId) {
        detailTweetId = focused?.id
        detailScroll = 0
      }
      detailAuthorName.content = focused ? `${focused.author.name}${focused.author.verified ? ' ✔' : ''}` : ''
      detailAuthorHandle.content = focused ? `@${focused.author.handle}${focused.repostedBy ? `  ·  ↻ ${focused.repostedBy.name} reposted` : ''}` : ''
      detailAvatarSlot = focused?.author.avatarUrl
        ? { key: `avatar:detail:${focused.id}`, url: focused.author.avatarUrl, box: detailAvatar, pane: detailPane, width: 1, height: 1, minCols: avatarCols, minRows: avatarRows }
        : undefined
      detailLines = wrapText(focused ? decodeEntities(focused.text) : 'Select a tweet with j/k.', detailText.width)
      const photo = previewOf(focused)
      mediaText.content = focused && focused.media.length > 0 ? focused.media.map(formatMedia).join('  ·  ') : 'No media for selected tweet.'
      const quoted = focused?.quotedTweet
      const quotePhoto = previewOf(quoted)
      const parentId = parentIdOf(state)
      const parent = parentId !== undefined ? state.tweets[parentId] : undefined
      const layout = detailLayout(detailPane.height, { photo: photo !== undefined, quote: quoted !== undefined, quotePhoto: quotePhoto !== undefined, parent: parent !== undefined, textLines: detailLines.length })
      detailText.height = layout.text
      detailScroll = clampScroll(detailScroll, detailLines.length, layout.text)
      detailText.content = blockContent(detailBlock(detailLines, detailScroll, layout.text))
      detailHints.content = detailHint(focused, state.detailStack.length, parent !== undefined)
      const parentSelected = parent !== undefined && parent.id === state.selectedDetailId
      parentBox.visible = parent !== undefined
      parentBox.height = layout.parent
      parentBox.borderColor = parentSelected ? '#58a6ff' : '#30363d'
      parentBox.backgroundColor = parentSelected ? '#111b2b' : '#0d1117'
      parentAuthor.content = parent ? `↩ Replying to ${parent.author.name}${parent.author.verified ? ' ✔' : ''}  @${parent.author.handle}` : ''
      parentAuthor.fg = parentSelected ? '#58a6ff' : '#f0f6fc'
      parentText.content = parent ? decodeEntities(parent.text).replaceAll('\n', ' ') : ''
      parentAvatarSlot = parent?.author.avatarUrl && layout.parent > 0
        ? { key: `avatar:parent:${parent.id}`, url: parent.author.avatarUrl, box: parentAvatar, pane: parentBox, width: 1, height: 1, minCols: avatarCols, minRows: avatarRows }
        : undefined
      parentBox.onMouseDown = parent ? () => { opts.onOpenTweet?.(parent.id) } : undefined
      detailMetrics.content = focused ? metricsLine(focused) : ''
      repliesList.height = layout.replies
      // An empty image box would still claim its share of the pane, so hide it.
      mediaBox.visible = layout.media > 0
      mediaBox.height = layout.media
      mediaSlot = photo && focused && layout.media > 0
        ? { key: `media:${focused.id}`, url: photo.url, box: mediaBox, pane: detailPane, width: photo.width, height: photo.height, minRows: mediaFloor }
        : undefined
      quoteBox.visible = quoted !== undefined
      quoteBox.height = layout.quote
      const quoteMediaRows = layout.quote - quoteRows
      quoteMediaBox.visible = quotePhoto !== undefined && quoteMediaRows > 0
      quoteAuthor.content = quoted ? `${quoted.author.name}${quoted.author.verified ? ' ✔' : ''}  @${quoted.author.handle}` : ''
      quoteText.content = quoted ? decodeEntities(quoted.text).replaceAll('\n', ' ') : ''
      quoteAvatarSlot = quoted?.author.avatarUrl
        ? { key: `avatar:${quoted.id}`, url: quoted.author.avatarUrl, box: quoteAvatar, pane: quoteBox, width: 1, height: 1, minCols: avatarCols, minRows: avatarRows }
        : undefined
      quoteMediaSlot = quotePhoto && quoted && quoteMediaRows > 0
        ? { key: `media:${quoted.id}`, url: quotePhoto.url, box: quoteMediaBox, pane: quoteBox, width: quotePhoto.width, height: quotePhoto.height, minRows: mediaFloor }
        : undefined
      repliesHeader.content = repliesTitle(replyIdsOf(state).length, state.selectedDetailId ? replyIdsOf(state).indexOf(state.selectedDetailId) : -1)
      renderReplyCards(state, layout.replies)
      composer.visible = state.composer.open
      composerTitle.content = composerHeading(state)
      composerText.content = state.composer.error ? `${state.composer.draft || 'Start typing…'}\n\nError: ${state.composer.error}` : state.composer.draft || 'Start typing…'
      statusText.content = state.status
      statusText.fg = state.status.includes('error') || state.status.includes('failed') ? '#ff7b72' : '#7d8590'
      renderCards(state)
      renderer.requestRender()
    },
    placements() {
      const cell = cellSize(renderer.resolution, renderer.terminalWidth, renderer.terminalHeight, process.env.TWEETER_CELL_PX)
      // The hidden panes keep their last measured size, so the lightbox states outright
      // that it owns the screen rather than relying on their boxes collapsing.
      if (lightboxSlot) {
        return [toPlacement(lightboxSlot, 'rect', cell, renderer)].filter((placement): placement is ImagePlacement => placement !== undefined)
      }
      const circles = [...slots, ...replySlots, detailAvatarSlot, parentAvatarSlot, quoteAvatarSlot].filter((slot): slot is ImageSlot => slot !== undefined)
      const rects = [mediaSlot, quoteMediaSlot].filter((slot): slot is ImageSlot => slot !== undefined)
      return [
        ...circles.map((slot) => toPlacement(slot, 'circle', cell, renderer)),
        ...rects.map((slot) => toPlacement(slot, 'rect', cell, renderer))
      ].filter((placement): placement is ImagePlacement => placement !== undefined)
    },
    scrollDetail(delta: number) {
      detailScroll = clampScroll(detailScroll + delta, detailLines.length, detailText.height)
    },
    destroy() {
      clearCards()
      clearReplyCards()
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
    height: cardHeight,
    border: true,
    borderStyle: 'rounded',
    borderColor: selected ? '#58a6ff' : '#30363d',
    backgroundColor: selected ? '#111b2b' : '#0d1117',
    paddingX: 1,
    flexDirection: 'row',
    gap: 1
  })
}

// Terminal coordinates are 1-based; a slot that spills past its pane is dropped so
// the image never paints over a neighbouring panel.
const toPlacement = (slot: ImageSlot, shape: 'circle' | 'rect', cell: CellSize, renderer: CliRenderer): ImagePlacement | undefined => {
  const maxCols = slot.box.width
  const maxRows = slot.box.height
  // A clipped card shrinks its avatar box; drawing into the remainder looks squashed.
  if (maxCols < (slot.minCols ?? 1) || maxRows < (slot.minRows ?? 1)) {
    return undefined
  }
  const insidePane = slot.box.x >= slot.pane.x && slot.box.y >= slot.pane.y
    && slot.box.x + maxCols <= slot.pane.x + slot.pane.width
    && slot.box.y + maxRows <= slot.pane.y + slot.pane.height
  const onScreen = slot.box.x + maxCols <= renderer.terminalWidth && slot.box.y + maxRows <= renderer.terminalHeight
  if (!insidePane || !onScreen) {
    return undefined
  }
  const fit = slot.width && slot.height ? fitCells(slot.width, slot.height, maxCols, maxRows, cell) : { cols: maxCols, rows: maxRows }
  return { key: slot.key, url: slot.url, shape, col: slot.box.x + 1, row: slot.box.y + 1, cols: fit.cols, rows: fit.rows }
}

// The quote card is the only clickable target that is not obvious, so the hint line
// states it both ways: how to go in, and how to come back out. The depth counts quotes
// and replies alike, because both push onto the same stack.
export const detailHint = (tweet: AppTweet | undefined, depth: number, hasParent = false): string => {
  if (!tweet) {
    return 'Select a tweet with j/k.'
  }
  const parts: string[] = []
  if (depth > 0) {
    parts.push(`depth ${depth}  ·  Shift+← back`)
  }
  if (hasParent) {
    parts.push('Shift+↑ picks the card above')
  }
  if (tweet.quotedTweet) {
    parts.push('Shift+→ or click the quote')
  }
  return parts.join('  ·  ')
}

// x.com labels a reposted tweet with the name of whoever put it in the feed. Everything
// else on the card already belongs to the original author.
export const repostPill = (tweet: AppTweet): string =>
  tweet.repostedBy ? `↻ ${tweet.repostedBy.name} · ` : ''

const cardMetrics = (tweet: AppTweet): string =>
  `${tweet.metrics.replies ?? 0} replies   ${tweet.metrics.reposts ?? 0} reposts   ${tweet.metrics.likes ?? 0} likes`

export const repliesTitle = (total: number, index: number): string => {
  if (total === 0) {
    return 'Replies'
  }
  const position = index >= 0 ? `${index + 1}/${total}  ·  Shift+→ opens it` : `${total}  ·  → picks one`
  return `Replies · ${position}`
}

// The handle says who reads the reply, and the count says whether X will take it. A
// draft over the limit is refused, so the counter turns into the warning.
export const composerHeading = (state: AppState): string => {
  const id = state.composer.replyToTweetId
  const target = id ? state.tweets[id] : undefined
  const who = target ? `@${target.author.handle}` : (id ?? 'tweet')
  const used = state.composer.draft.trim().length
  const count = used > tweetTextLimit ? `${used}/${tweetTextLimit} too long` : `${used}/${tweetTextLimit}`
  if (state.composer.sending) {
    return `Replying to ${who} · sending…`
  }
  return `Replying to ${who} · ${count} · Enter sends · Esc closes`
}

// The replies fetch themselves, so an empty list is either still in flight, refused, or
// genuinely empty. Only the middle case asks the reader for a keystroke.
export const repliesEmpty = (conversation: ConversationState | undefined): string => {
  if (conversation?.error !== undefined) {
    return `Replies failed: ${conversation.error} · Enter retries.`
  }
  if (!conversation || conversation.loading) {
    return 'Loading replies…'
  }
  return 'No replies yet.'
}

export const metricsLine = (tweet: AppTweet): string => {
  const counts = [
    `${tweet.metrics.replies ?? 0} comments`,
    `${tweet.metrics.reposts ?? 0} reposts`,
    `${tweet.metrics.likes ?? 0} likes`
  ]
  if (tweet.metrics.views !== undefined) {
    counts.push(`${tweet.metrics.views} views`)
  }
  return counts.join('   ·   ')
}

// A terminal cannot play the mp4, so the pane draws the still frame and says which key
// hands the video to the system player.
export const formatMedia = (media: AppMedia): string => {
  const size = media.width && media.height ? ` ${media.width}×${media.height}` : ''
  if (media.type === 'photo') {
    return `${media.type}${size}`
  }
  const parts = [`${media.type}${size}`]
  if (media.durationMs !== undefined) {
    parts.push(formatDuration(media.durationMs))
  }
  if (media.videoUrl !== undefined) {
    parts.push('v plays it')
  }
  return parts.join(' · ')
}

const formatDuration = (ms: number): string => {
  const total = Math.round(ms / 1000)
  const minutes = Math.trunc(total / 60)
  return `${minutes}:${String(total - minutes * 60).padStart(2, '0')}`
}
