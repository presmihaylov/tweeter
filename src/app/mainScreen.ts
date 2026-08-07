import { BoxRenderable, CliRenderEvents, TextRenderable, type CliRenderer, type Renderable } from '@opentui/core'
import { focusedTweet, parentIdOf, previewOf, previewsOf, replyIdsOf, type AppState, type ConversationState, type FeedId, type FeedSort } from '../state/store.ts'
import type { AppMedia, AppTweet, AuthStatus, WriteRetryNotice } from '../twitter/types.ts'
import { automationWriteCode, tweetTextLimit } from '../twitter/constants.ts'
import type { CellSize, ImagePlacement } from '../media/imageLayer.ts'
import { cellSize, fitCells } from '../media/geometry.ts'

export type MainScreen = {
  render(state: AppState, auth?: AuthStatus): void
  placements(): ImagePlacement[]
  scrollDetail(delta: number): void
  // Only a text that does not fit the pane earns a stop for the arrows, and the pane
  // measures itself, so the key handler has to ask the screen.
  detailScrolls(): boolean
  // Which article image the pane is showing, for the key that enlarges one.
  visibleArticleImage(): { media: AppMedia; key: string } | undefined
  destroy(): void
}

export type MainScreenOptions = {
  onOpenPhoto?: (source: 'tweet' | 'quote', index?: number) => void
  onCloseLightbox?: () => void
  onOpenQuote?: () => void
  onOpenTweet?: (tweetId: string) => void
  onOpenArticleImage?: (media: AppMedia, key: string) => void
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
// An article image shares the text area with the words around it, so it never takes more
// rows than a paragraph would.
const articleImageCap = 10

export type DetailLayout = { parent: number; text: number; media: number; quote: number; replies: number }

// Flex alone let the quote card eat the photo's rows, so the detail pane divides them
// itself. Order of claim: the parent card, the quote card text, the tweet text, the
// quoted photo, the tweet photo, then the replies. Anything under mediaFloor draws as a
// useless sliver, so those rows go back to the replies instead.
export const detailLayout = (paneHeight: number, opts: { photo: boolean; quote: boolean; quotePhoto: boolean; parent: boolean; textLines: number; article?: boolean }): DetailLayout => {
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
  // A short tweet gives its spare rows to the photo; a long one scrolls at the cap. An
  // article carries thousands of characters, so it keeps every row the pane can spare
  // above one reply card, or the reader would hold the scroll key for a page at a time.
  const reserved = repliesFloor + (opts.photo ? mediaFloor : 0)
  const cap = opts.article ? Math.max(detailTextCap, body - parent - quoteBase - reserved) : detailTextCap
  const wanted = Math.min(cap, Math.max(detailTextFloor, opts.textLines))
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

// An article puts its images between the paragraphs, so the pane cannot draw the body as
// one block of text. It becomes a flow instead: rows of text with picture boxes among
// them, which scrolls as one column the way the article reads on x.com.
export type FlowItem =
  | { kind: 'line'; text: string; style?: 'header' }
  | { kind: 'image'; key: string; media: AppMedia; rows: number }

const rowsOf = (item: FlowItem): number => (item.kind === 'line' ? 1 : item.rows)

export const flowRows = (items: FlowItem[]): number => items.reduce((total, item) => total + rowsOf(item), 0)

const lineItems = (lines: string[], style?: 'header'): FlowItem[] =>
  lines.map((text) => (style ? { kind: 'line', text, style } : { kind: 'line', text }))

// A bullet keeps its dot on the first row only, so the wrapped rest lines up under the
// words rather than under the dot.
const bulletItems = (text: string, width: number): FlowItem[] =>
  wrapText(decodeEntities(text), Math.max(1, width - 2))
    .map((line, index) => ({ kind: 'line' as const, text: `${index === 0 ? '• ' : '  '}${line}` }))

// An image claims whole rows, so it may not take more than the cap however tall it is.
export const imageRows = (media: AppMedia, width: number, cell: CellSize, cap = articleImageCap): number => {
  if (width < 1 || !media.width || !media.height) {
    return Math.min(cap, mediaFloor)
  }
  return fitCells(media.width, media.height, width, cap, cell).rows
}

// A picture only draws on the rows the window has left for it, so a tall one leaves a hole
// at the foot of the body until the scroll reaches it. Half the window is the largest a
// picture may be before those holes show, so the body height caps it too.
export const bodyImageCap = (rows: number): number => Math.max(mediaFloor, Math.min(articleImageCap, Math.floor(rows / 2)))

export const detailFlow = (tweet: AppTweet | undefined, width: number, cell: CellSize, empty: string, cap = articleImageCap): FlowItem[] => {
  const blocks = tweet?.article?.blocks
  if (!tweet || blocks === undefined || blocks.length === 0) {
    return lineItems(wrapText(tweet ? decodeEntities(tweet.text) : empty, width))
  }
  const items: FlowItem[] = lineItems(wrapText(decodeEntities(tweet.article?.title ?? ''), width), 'header')
  let images = 0
  for (const block of blocks) {
    items.push({ kind: 'line', text: '' })
    if (block.kind === 'image') {
      items.push({ kind: 'image', key: `article:${tweet.id}:${images}`, media: block.media, rows: imageRows(block.media, width, cell, cap) })
      images += 1
      if (block.caption !== undefined) {
        items.push(...lineItems(wrapText(decodeEntities(block.caption), width)))
      }
      continue
    }
    if (block.style === 'bullet') {
      items.push(...bulletItems(block.text, width))
      continue
    }
    items.push(...lineItems(wrapText(decodeEntities(block.text), width), block.style === 'header' ? 'header' : undefined))
  }
  return items
}

export type DetailBlock = { above?: string; lines: string[]; below?: string }
export type FlowBlock = { above?: string; items: FlowItem[]; below?: string }

// A cut tweet has to say so inside the text itself, not only in the hint line, so the
// block spends a row on a marker at each edge that still hides text. The marker names the
// key that works from where the arrows are, because both pairs scroll the same text.
export const flowBlock = (items: FlowItem[], top: number, rows: number, focused = false): FlowBlock => {
  if (rows < 1) {
    return { items: [] }
  }
  if (flowRows(items) <= rows) {
    return { items }
  }
  const above = top > 0
  const room = Math.max(0, rows - (above ? 1 : 0))
  const fill = (budget: number): FlowItem[] => {
    const taken: FlowItem[] = []
    let used = 0
    for (const item of items.slice(top)) {
      if (used + rowsOf(item) > budget) {
        break
      }
      taken.push(item)
      used += rowsOf(item)
    }
    return taken
  }
  const whole = fill(room)
  // The bottom marker costs a row, so the last item has to go when one is still hidden.
  const shown = top + whole.length < items.length ? fill(room - 1) : whole
  // An image taller than the whole text area would otherwise stop the scroll dead.
  const drawn = shown.length === 0 && top < items.length ? items.slice(top, top + 1) : shown
  const hidden = flowRows(items.slice(top + drawn.length))
  return {
    above: above ? `▴ ${flowRows(items.slice(0, top))} more above · ${focused ? '↑' : 'Ctrl+W'}` : undefined,
    items: drawn,
    below: hidden > 0 ? `▾ ${hidden} more below · ${focused ? '↓' : 'Ctrl+S'}` : undefined
  }
}

export const detailBlock = (lines: string[], top: number, rows: number, focused = false): DetailBlock => {
  const block = flowBlock(lineItems(lines), top, rows, focused)
  return {
    above: block.above,
    lines: block.items.map((item) => (item.kind === 'line' ? item.text : '')).slice(0, rows),
    below: block.below
  }
}

// The last page spends a row on the "more above" marker, so the deepest start is the one
// whose tail still fits in the rows that are left.
export const clampFlowScroll = (items: FlowItem[], top: number, rows: number): number => {
  if (top <= 0 || flowRows(items) <= rows) {
    return 0
  }
  let used = 0
  let deepest = items.length
  for (let index = items.length - 1; index >= 0; index -= 1) {
    used += rowsOf(items[index] ?? { kind: 'line', text: '' })
    if (used > rows - 1) {
      break
    }
    deepest = index
  }
  return Math.min(top, deepest)
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

// One tile per picture on the tweet. The row is rebuilt on every frame, the way the cards
// are, because the open tweet changes how many pictures the row holds.
type TileRow = { tiles: BoxRenderable[]; slots: ImageSlot[] }

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
    flexShrink: 1,
    truncate: true,
    height: 1
  })
  const headerKeys = new TextRenderable(renderer, {
    id: 'main-header-keys',
    content: 'R refresh Tab feed s sort j/k feed ←/→ focus ↑/↓ move Shift+→ open Enter more l like r reply t quote p photo v video o open q quit',
    fg: '#58a6ff',
    width: 130,
    height: 1,
    // Two more hints made the row wider than a 173-column window, which pushed the right
    // border off the screen. Shrinking beats overflowing.
    flexShrink: 1,
    truncate: true
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
  // wrapMode box cannot be scrolled. The body is a column rather than one text box,
  // because an article puts its images between the paragraphs.
  const detailBody = new BoxRenderable(renderer, {
    id: 'detail-body',
    width: '100%',
    height: detailTextFloor,
    flexShrink: 0,
    overflow: 'hidden',
    flexDirection: 'column'
  })
  const mediaText = new TextRenderable(renderer, {
    id: 'detail-media',
    content: '',
    fg: '#d29922',
    width: '100%',
    height: 1,
    truncate: true
  })
  // A tweet carries up to four pictures, so the row holds one tile for each of them.
  const mediaBox = new BoxRenderable(renderer, {
    id: 'detail-media-image',
    width: '100%',
    height: 0,
    flexShrink: 0,
    flexDirection: 'row',
    gap: 1
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
    minHeight: 0,
    flexDirection: 'row',
    gap: 1
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
  detailPane.add(detailBody)
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

  // The terminal draws its own cursor, so the drawer only says which cell it belongs in.
  // The drawer is measured after it is painted, so the cell follows the painted frame; a
  // cursor placed from the render pass would sit a row behind after every wrap.
  let caret: { row: number; col: number } | undefined
  const paintCaret = (): void => {
    if (!caret) {
      renderer.setCursorPosition(0, 0, false)
      return
    }
    renderer.setCursorPosition(composerText.x + caret.col + 1, composerText.y + caret.row + 1, true)
  }
  renderer.on(CliRenderEvents.FRAME, paintCaret)

  let cards: BoxRenderable[] = []
  let slots: ImageSlot[] = []
  let replyCards: Renderable[] = []
  let replySlots: ImageSlot[] = []
  let replyTop = 0
  let mediaTiles: TileRow = { tiles: [], slots: [] }
  let quoteTiles: TileRow = { tiles: [], slots: [] }
  let parentAvatarSlot: ImageSlot | undefined
  let quoteAvatarSlot: ImageSlot | undefined
  let detailAvatarSlot: ImageSlot | undefined
  let lightboxSlot: ImageSlot | undefined
  let articleSlots: ImageSlot[] = []
  let bodyParts: Renderable[] = []
  let scrollTop = 0
  let detailScroll = 0
  let detailItems: FlowItem[] = []
  let detailTweetId: string | undefined

  const clearCards = (): void => {
    for (const card of cards) {
      timelineCards.remove(card.id)
      card.destroyRecursively()
    }
    cards = []
  }

  const clearBodyParts = (): void => {
    for (const part of bodyParts) {
      detailBody.remove(part.id)
      part.destroyRecursively()
    }
    bodyParts = []
  }

  // The whole body is rebuilt on every frame, the way the cards are, because a scroll
  // changes which runs of text and which pictures the column holds.
  const renderBody = (block: FlowBlock, focused: boolean): void => {
    clearBodyParts()
    articleSlots = []
    const marker = '#58a6ff'
    let index = 0
    const push = (part: Renderable): void => {
      detailBody.add(part)
      bodyParts.push(part)
    }
    const textPart = (lines: string[], color: string): void => {
      push(new TextRenderable(renderer, { id: `detail-body-${index++}`, content: lines.join('\n'), fg: color, width: '100%', height: lines.length }))
    }
    if (block.above !== undefined) {
      textPart([block.above], marker)
    }
    let run: { style?: 'header'; lines: string[] } | undefined
    const flush = (): void => {
      if (run) {
        textPart(run.lines, run.style === 'header' ? '#f0f6fc' : (focused ? '#f0f6fc' : '#c9d1d9'))
        run = undefined
      }
    }
    for (const item of block.items) {
      if (item.kind === 'line') {
        if (run && run.style !== item.style) {
          flush()
        }
        run = run ?? (item.style ? { style: item.style, lines: [] } : { lines: [] })
        run.lines.push(item.text)
        continue
      }
      flush()
      const box = new BoxRenderable(renderer, { id: `detail-body-${index++}`, width: '100%', height: item.rows, flexShrink: 0 })
      box.onMouseDown = () => { opts.onOpenArticleImage?.(item.media, item.key) }
      push(box)
      articleSlots.push({ key: item.key, url: item.media.url, box, pane: detailPane, width: item.media.width, height: item.media.height, minRows: mediaFloor })
    }
    flush()
    if (block.below !== undefined) {
      textPart([block.below], marker)
    }
  }

  // The tiles share the row, so four pictures each take a quarter of it. A click on one
  // names its own index, or the second picture would enlarge the first.
  const renderTiles = (
    row: TileRow,
    args: { box: BoxRenderable; pane: BoxRenderable; id: string; source: 'tweet' | 'quote'; tweet: AppTweet | undefined; visible: boolean }
  ): TileRow => {
    for (const tile of row.tiles) {
      args.box.remove(tile.id)
      tile.destroyRecursively()
    }
    const next: TileRow = { tiles: [], slots: [] }
    const tweet = args.tweet
    if (!tweet || !args.visible) {
      return next
    }
    previewsOf(tweet).forEach((media, index) => {
      const tile = new BoxRenderable(renderer, { id: `${args.id}-${index}`, flexGrow: 1, flexBasis: 0, minWidth: 0, height: '100%' })
      // A click bubbles to the card behind it, which would open the quote as well.
      tile.onMouseDown = (event) => {
        event.stopPropagation()
        opts.onOpenPhoto?.(args.source, index)
      }
      args.box.add(tile)
      next.tiles.push(tile)
      next.slots.push({ key: `media:${tweet.id}:${index}`, url: media.url, box: tile, pane: args.pane, width: media.width, height: media.height, minRows: mediaFloor })
    })
    return next
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
        content: `${articlePill(reply)}${repostPill(reply)}${reply.author.name}${reply.author.verified ? ' ✔' : ''}  @${reply.author.handle}${reply.quotedTweet ? '  quote' : ''}`,
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
        content: `${articlePill(tweet)}${repostPill(tweet)}${tweet.author.name}${tweet.author.verified ? ' ✔' : ''}  @${tweet.author.handle}${mediaPill}`,
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
      headerMeta.content = `${auth?.ok ? handle : 'auth pending'} · ${feedName(state.activeFeed)}`
      railFeeds.content = `${state.activeFeed === 'following' ? '●' : '○'} Following\n${state.activeFeed === 'forYou' ? '●' : '○'} For You\n\nTab switches\ns sorts`
      railProfile.content = auth?.ok ? `Signed in\n${handle}\n\n${auth.name ?? ''}` : 'Checking credentials…'
      timelineHeader.content = timelineTitle(state.activeFeed, state.feedSort, timeline.tweetIds.length)
      // A new tweet always starts at its first line, never at the old offset.
      if (focused?.id !== detailTweetId) {
        detailTweetId = focused?.id
        detailScroll = 0
      }
      detailAuthorName.content = focused ? `${focused.author.name}${focused.author.verified ? ' ✔' : ''}` : ''
      detailAuthorHandle.content = focused ? `${articlePill(focused)}@${focused.author.handle}${focused.repostedBy ? `  ·  ↻ ${focused.repostedBy.name} reposted` : ''}` : ''
      detailAvatarSlot = focused?.author.avatarUrl
        ? { key: `avatar:detail:${focused.id}`, url: focused.author.avatarUrl, box: detailAvatar, pane: detailPane, width: 1, height: 1, minCols: avatarCols, minRows: avatarRows }
        : undefined
      const cell = cellSize(renderer.resolution, renderer.terminalWidth, renderer.terminalHeight, process.env.TWEETER_CELL_PX)
      detailItems = detailFlow(focused, detailBody.width, cell, 'Select a tweet with j/k.')
      const photo = previewOf(focused)
      mediaText.content = mediaLine(focused, detailItems)
      const quoted = focused?.quotedTweet
      const quotePhoto = previewOf(quoted)
      const parentId = parentIdOf(state)
      const parent = parentId !== undefined ? state.tweets[parentId] : undefined
      const layout = detailLayout(detailPane.height, { photo: photo !== undefined, quote: quoted !== undefined, quotePhoto: quotePhoto !== undefined, parent: parent !== undefined, textLines: flowRows(detailItems), article: focused?.article !== undefined })
      // The row budget only exists once the layout is out, so the flow is built again with
      // pictures that fit inside it. An article body always overflows, so the budget itself
      // does not move.
      const cap = bodyImageCap(layout.text)
      if (cap !== articleImageCap && detailItems.some((item) => item.kind === 'image')) {
        detailItems = detailFlow(focused, detailBody.width, cell, 'Select a tweet with j/k.', cap)
      }
      detailBody.height = layout.text
      detailScroll = clampFlowScroll(detailItems, detailScroll, layout.text)
      // The arrows own the text now, so it brightens the way a selected card does.
      renderBody(flowBlock(detailItems, detailScroll, layout.text, state.textFocused), state.textFocused)
      detailHints.content = detailHint(focused, state.detailStack.length, parent !== undefined, { scrolls: flowRows(detailItems) > layout.text, focused: state.textFocused })
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
      mediaTiles = renderTiles(mediaTiles, { box: mediaBox, pane: detailPane, id: 'detail-media-tile', source: 'tweet', tweet: focused, visible: layout.media > 0 })
      quoteBox.visible = quoted !== undefined
      quoteBox.height = layout.quote
      const quoteMediaRows = layout.quote - quoteRows
      quoteMediaBox.visible = quotePhoto !== undefined && quoteMediaRows > 0
      quoteAuthor.content = quoted ? `${quoted.author.name}${quoted.author.verified ? ' ✔' : ''}  @${quoted.author.handle}` : ''
      quoteText.content = quoted ? decodeEntities(quoted.text).replaceAll('\n', ' ') : ''
      quoteAvatarSlot = quoted?.author.avatarUrl
        ? { key: `avatar:${quoted.id}`, url: quoted.author.avatarUrl, box: quoteAvatar, pane: quoteBox, width: 1, height: 1, minCols: avatarCols, minRows: avatarRows }
        : undefined
      quoteTiles = renderTiles(quoteTiles, { box: quoteMediaBox, pane: quoteBox, id: 'detail-quote-tile', source: 'quote', tweet: quoted, visible: quoteMediaRows > 0 })
      repliesHeader.content = repliesTitle(replyIdsOf(state).length, state.selectedDetailId ? replyIdsOf(state).indexOf(state.selectedDetailId) : -1)
      renderReplyCards(state, layout.replies)
      composer.visible = state.composer.open
      composerTitle.content = composerHeading(state)
      // The drawer is measured only after it is drawn, so the shell gives the width until then:
      // its own pad, then the border and the pad of the drawer.
      const composerWidth = composerText.width > 0 ? composerText.width : renderer.terminalWidth - 6
      const drawer = composerBody(state.composer.draft, state.composer.error, composerWidth, state.composer.caret)
      composer.height = drawer.height
      composerText.content = drawer.text
      caret = state.composer.open ? { row: drawer.caretRow, col: drawer.caretCol } : undefined
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
      const rects = [...articleSlots, ...mediaTiles.slots, ...quoteTiles.slots]
      return [
        ...circles.map((slot) => toPlacement(slot, 'circle', cell, renderer)),
        ...rects.map((slot) => toPlacement(slot, 'rect', cell, renderer))
      ].filter((placement): placement is ImagePlacement => placement !== undefined)
    },
    scrollDetail(delta: number) {
      detailScroll = clampFlowScroll(detailItems, detailScroll + delta, detailBody.height)
    },
    detailScrolls() {
      return flowRows(detailItems) > detailBody.height
    },
    // p enlarges a picture without a mouse, so it needs the one the reader can see.
    visibleArticleImage() {
      const slot = articleSlots[0]
      const item = detailItems.find((candidate): candidate is Extract<FlowItem, { kind: 'image' }> => candidate.kind === 'image' && candidate.key === slot?.key)
      return item ? { media: item.media, key: item.key } : undefined
    },
    destroy() {
      renderer.off(CliRenderEvents.FRAME, paintCaret)
      renderer.setCursorPosition(0, 0, false)
      clearCards()
      clearReplyCards()
      clearBodyParts()
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
export const detailHint = (tweet: AppTweet | undefined, depth: number, hasParent = false, scroll?: { scrolls: boolean; focused: boolean }): string => {
  if (!tweet) {
    return 'Select a tweet with j/k.'
  }
  const parts: string[] = []
  if (scroll?.focused) {
    parts.push('↑/↓ scroll  ·  → replies')
  }
  if (scroll?.scrolls && !scroll.focused) {
    parts.push(`→ reads the ${tweet.article ? 'article' : 'text'}`)
  }
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

// An article is a headline over thousands of characters. Without a badge the card reads as
// an ordinary tweet whose text happens to stop after the title. It goes in front of the
// name, because a card line is narrow and a truncated line loses its end first.
export const articlePill = (tweet: AppTweet | undefined): string => (tweet?.article ? '▤ article · ' : '')

// x.com fills the heart on a tweet you have liked. A count alone cannot show that, so the
// filled glyph carries it here.
export const likeCount = (tweet: AppTweet): string =>
  `${tweet.favorited === true ? '♥ ' : ''}${tweet.metrics.likes ?? 0} likes`

const cardMetrics = (tweet: AppTweet): string =>
  `${tweet.metrics.replies ?? 0} replies   ${tweet.metrics.reposts ?? 0} reposts   ${likeCount(tweet)}`

export const feedName = (feed: FeedId): string => (feed === 'following' ? 'Following' : 'For You')

export const sortName = (sort: FeedSort): string => (sort === 'popular' ? 'Popular' : 'Recent')

// Only Following can be sorted, so naming a sort on For You would promise a control the
// key does not give there.
export const timelineTitle = (feed: FeedId, sort: FeedSort, count: number): string => {
  const sortLabel = feed === 'following' ? `${sortName(sort)} · ` : ''
  return `${feedName(feed)} · ${sortLabel}${count} tweets`
}

export const repliesTitle = (total: number, index: number): string => {
  if (total === 0) {
    return 'Replies'
  }
  const position = index >= 0 ? `${index + 1}/${total}  ·  Shift+→ opens it` : `${total}  ·  → picks one`
  return `Replies · ${position}`
}

// The handle says whose tweet the draft answers or reposts, and the count says whether X
// will take it. A draft over the limit is refused, so the counter turns into the warning.
export const composerHeading = (state: AppState): string => {
  const id = state.composer.targetTweetId
  const target = id ? state.tweets[id] : undefined
  const who = target ? `@${target.author.handle}` : (id ?? 'tweet')
  const lead = state.composer.mode === 'quote' ? `Quoting ${who}` : `Replying to ${who}`
  const used = state.composer.draft.trim().length
  const count = used > tweetTextLimit ? `${used}/${tweetTextLimit} too long` : `${used}/${tweetTextLimit}`
  if (state.composer.sending) {
    return `${lead} · sending…`
  }
  return `${lead} · ${count} · Enter sends · Esc closes`
}

// The drawer holds a border, a pad on each side and the heading, so a draft of one row
// needs five rows around it.
const composerChrome = 5

// Eight rows hold a full 280-character draft down to a 40-column window, and the timeline
// keeps the rest of the screen.
export const composerTextCap = 8

// One drawn row of the draft. `start` is where the row begins inside the draft, which is
// what turns a caret counted in characters into a row and a column on the screen.
export type ComposerRow = { text: string; start: number }

// wrapText is for a tweet that is already written, so it drops the spacing the author typed.
// The composer shows a draft as it is typed, so this wrap keeps every space except the one it
// breaks on.
export const composerRows = (draft: string, width: number): ComposerRow[] => {
  const rows: ComposerRow[] = []
  let offset = 0
  for (const paragraph of draft.split('\n')) {
    let rest = paragraph
    let start = offset
    while (width >= 1 && rest.length > width) {
      const space = rest.lastIndexOf(' ', width)
      // A word wider than the drawer has to be cut, or it would never break and never wrap.
      const cut = space > 0 ? space : width
      rows.push({ text: rest.slice(0, cut), start })
      // The space it broke on is drawn nowhere, so the next row starts past it.
      const step = space > 0 ? cut + 1 : cut
      rest = rest.slice(step)
      start += step
    }
    rows.push({ text: rest, start })
    offset = start + rest.length + 1
  }
  return rows
}

export const composerLines = (draft: string, width: number): string[] =>
  composerRows(draft, width).map((row) => row.text)

// The last row that starts at or before the caret is the row the caret is on. A caret on the
// space a row broke on belongs to the row it ends, which is where the reader typed it.
const caretCell = (rows: ComposerRow[], caret: number): { row: number; col: number } => {
  let index = 0
  for (let candidate = 0; candidate < rows.length; candidate += 1) {
    index = (rows[candidate]?.start ?? 0) <= caret ? candidate : index
  }
  const row = rows[index]
  return { row: index, col: Math.min(caret - (row?.start ?? 0), row?.text.length ?? 0) }
}

// A one-row drawer cut the draft off at the width instead of wrapping it, so the drawer grows
// with what it holds. Past the cap the head of the draft goes, never the foot: the reader
// types at the foot, and the error under it says why the reply did not go.
export const composerBody = (draft: string, error: string | undefined, width: number, caret = draft.length, cap = composerTextCap): { text: string; height: number; caretRow: number; caretCol: number } => {
  const empty = draft === ''
  const written = composerRows(empty ? 'Start typing…' : draft, width)
  const cell = caretCell(written, empty ? 0 : caret)
  const full = error === undefined ? [] : ['', ...composerLines(`Error: ${error}`, width)]
  // The whole drawer still owes the cap, so a long reason leaves the draft one row.
  const reason = full.slice(0, Math.max(0, cap - 1))
  const room = cap - reason.length
  // The head of the draft goes first, but never the row the caret is on: the reader has to
  // see what the next keystroke changes.
  const first = Math.min(Math.max(0, written.length - room), cell.row)
  const lines = [...written.slice(first, first + room).map((row) => row.text), ...reason]
  return { text: lines.join('\n'), height: composerChrome + lines.length, caretRow: cell.row - first, caretCol: cell.col }
}

// The gate stays shut for minutes, not for one request, so a reader who sends again at once
// only holds it shut. The advice belongs on the screen, where the refusal is.
const automationAdvice = 'X refused every retry. The gate opens again after a few quiet minutes, so wait before you send it again.'

// A refused write has to say why on screen, not only in the log. Code 226 is the automation
// gate and every other code means something else, so the number goes in front of the reader.
export const writeFailure = (what: string, result: { error: string; code?: number }, logPath: string): { error: string; status: string } => {
  const reason = result.code === undefined ? result.error : `${result.error} (code ${result.code})`
  const advice = result.code === automationWriteCode ? `\n${automationAdvice}` : ''
  return {
    error: `${reason}${advice}\nThe draft is kept. Log: ${logPath}`,
    status: `${what} failed (${result.code ?? 'no code'}); log: ${logPath}`
  }
}

// A delay of two minutes reads as "120.0s" under one decimal, so whole seconds lose theirs.
const delayLabel = (delayMs: number): string => `${Number((delayMs / 1000).toFixed(1))}s`

// X names code 344 a daily limit, which it is not. Repeating that message would send the
// reader off to check a quota that is not the problem, so say what the TUI is doing instead.
export const retryStatus = (what: string, notice: WriteRetryNotice): string =>
  `X refused the ${what} (code ${notice.code}); retry ${notice.attempt} of ${notice.attempts} in ${delayLabel(notice.delayMs)}`

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
    likeCount(tweet)
  ]
  if (tweet.metrics.views !== undefined) {
    counts.push(`${tweet.metrics.views} views`)
  }
  return counts.join('   ·   ')
}

// An article carries its pictures inside the body rather than under it, so the caption row
// says how to enlarge one instead of claiming the tweet has no media at all.
export const mediaLine = (tweet: AppTweet | undefined, items: FlowItem[]): string => {
  if (tweet && tweet.media.length > 0) {
    return tweet.media.map(formatMedia).join('  ·  ')
  }
  const images = items.filter((item) => item.kind === 'image').length
  if (images > 0) {
    return `${images} image${images === 1 ? '' : 's'} in the article  ·  click one, or p enlarges the one on screen`
  }
  return 'No media for selected tweet.'
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
