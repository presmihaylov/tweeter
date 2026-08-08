import { BoxRenderable, CliRenderEvents, TextRenderable, type CliRenderer, type Renderable } from '@opentui/core'
import { activeTimeline, focusedTweet, parentIdOf, previewOf, previewsOf, repliesOpen, replyIdsOf, searchQueryOf, tabOrder, type AppState, type ComposerMode, type ConversationState, type FeedSort, type NotificationsState, type TabId, type TimelineId } from '../state/store.ts'
import type { AppMedia, AppNotice, AppTweet, AuthStatus, NoticeIcon, NotificationRow, WriteRetryNotice } from '../twitter/types.ts'
import { automationWriteCode, tweetTextLimit } from '../twitter/constants.ts'
import type { CellSize, ImagePlacement } from '../media/imageLayer.ts'
import { cellSize, fitCells } from '../media/geometry.ts'
import { absoluteTime, relativeTime } from '../utils/time.ts'
import { statsBodyLines } from './statsView.ts'

export type MainScreen = {
  render(state: AppState, auth?: AuthStatus): void
  placements(): ImagePlacement[]
  scrollDetail(delta: number): void
  // Only a text that does not fit the pane earns a stop for the arrows, and the pane
  // measures itself, so the key handler has to ask the screen.
  detailScrolls(): boolean
  // Which article image the pane is showing, for the key that enlarges one.
  visibleArticleImage(): { media: AppMedia; key: string } | undefined
  // How far the stats card can scroll, which only the card knows: it is as tall as the
  // window it was drawn in.
  statsScrollMax(state: AppState): number
  destroy(): void
}

export type MainScreenOptions = {
  onOpenPhoto?: (source: 'tweet' | 'quote', index?: number) => void
  onCloseLightbox?: () => void
  onCloseHelp?: () => void
  onCloseStats?: () => void
  onOpenQuote?: () => void
  onOpenTweet?: (tweetId: string) => void
  onToggleReplies?: () => void
  onOpenArticleImage?: (media: AppMedia, key: string) => void
  // A relative stamp is only relative to something. A test pins the clock so "3h" stays "3h".
  now?: () => Date
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

// The replies view draws the author row, the header over the list and the metrics bar, and
// nothing else: 4 rows of border and padding, 3 gaps between the four boxes, and 5 rows for
// the three that are not the list.
const repliesViewChrome = 4 + 3 + 5

// Flex alone let the quote card eat the photo's rows, so the detail pane divides them
// itself. Order of claim: the parent card, the quote card text, the tweet text, the
// quoted photo, then the tweet photo. Anything under mediaFloor draws as a useless
// sliver, so those rows stay blank instead.
export const detailLayout = (paneHeight: number, opts: { photo: boolean; quote: boolean; quotePhoto: boolean; parent: boolean; textLines: number; article?: boolean; repliesOpen?: boolean }): DetailLayout => {
  if (paneHeight < 1) {
    return { parent: 0, text: opts.repliesOpen === true ? 0 : detailTextFloor, media: 0, quote: 0, replies: repliesFloor }
  }
  // The reply list is a view of its own, so it takes the pane rather than share it.
  if (opts.repliesOpen === true) {
    return { parent: 0, text: 0, media: 0, quote: 0, replies: Math.max(0, paneHeight - repliesViewChrome) }
  }
  const boxes = 6 + (opts.photo ? 1 : 0) + (opts.quote ? 1 : 0) + (opts.parent ? 1 : 0)
  // The border and padding take 4 rows. The author row, the caption, the replies header
  // and the metrics bar take 6 more between them.
  const body = Math.max(0, paneHeight - 4 - (boxes - 1) - 6)
  // The parent card is what the open tweet answers, so it is read before anything else.
  const parent = opts.parent ? Math.min(body, parentRows) : 0
  const quoteBase = opts.quote ? Math.min(body - parent, quoteRows) : 0
  // A short tweet gives its spare rows to the photo; a long one scrolls at the cap. An
  // article carries thousands of characters, so it keeps every row the pane can spare.
  const textRoom = body - parent - quoteBase
  const mediaWant = opts.photo ? mediaFloor : 0
  const cap = opts.article ? Math.max(detailTextCap, textRoom - mediaWant) : detailTextCap
  const natural = Math.min(cap, Math.max(detailTextFloor, opts.textLines))
  // The replies used to hold a whole card here, which is what squeezed a long tweet with a
  // quote under it down to a few rows. They live behind their own view now, so only the
  // photo floor stands between the text and the rows it asks for.
  const wanted = opts.article ? natural : Math.min(natural, Math.max(detailTextFloor, textRoom - mediaWant))
  const text = Math.max(0, Math.min(wanted, textRoom))
  const rest = Math.max(0, body - parent - quoteBase - text)
  const quoteWanted = opts.quote && opts.quotePhoto
    ? Math.min(quotePhotoRows, Math.max(0, rest - (opts.photo ? mediaFloor : 0)))
    : 0
  const quoteExtra = quoteWanted < mediaFloor ? 0 : quoteWanted
  const free = rest - quoteExtra
  const media = !opts.photo || free < mediaFloor ? 0 : Math.min(mediaCap, free)
  // Nothing waits under the photo any more, so a tweet longer than its cap takes the rows
  // the photo left rather than scroll over blank ones.
  const spare = free - media
  const extra = Math.min(spare, Math.max(0, opts.textLines - text))
  // What the text, the photo and the quote card leave over stays blank under them, which is
  // what keeps the metrics bar on the bottom row of the pane.
  return { parent, text: text + extra, media, quote: quoteBase + quoteExtra, replies: spare - extra }
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

export type HelpGroup = { title: string; entries: readonly { keys: string; what: string }[] }

export const helpHint = '? keys'

// Every key the app answers, in the three groups a reader thinks in: moving around the
// feed, acting on the tweet in front of them, and typing in the drawer.
export const helpGroups: readonly HelpGroup[] = [
  {
    title: 'Move around',
    entries: [
      { keys: 'j / k', what: 'walk the feed' },
      { keys: 'Tab', what: 'walk the tabs' },
      { keys: '/', what: 'add a tab that holds a search' },
      { keys: 'Shift+D', what: 'close the tab you added' },
      { keys: 's', what: 'sort Following' },
      { keys: 'R', what: 'refresh, newest on top' },
      { keys: 'c', what: 'the replies, on and off' },
      { keys: '→ / ←', what: 'aim the arrows: text, replies, feed' },
      { keys: '↑ / ↓', what: 'move the aim, or scroll the text' },
      { keys: 'Shift+↑ / ↓', what: 'walk the replies from the feed' },
      { keys: 'Shift+→', what: 'open the card under the aim' },
      { keys: 'Shift+←', what: 'back to the tweet you came from' },
      { keys: 'Ctrl+W / Ctrl+S', what: 'scroll a long tweet up or down' },
      { keys: 'Enter', what: 'load more replies, or a notice list' }
    ]
  },
  {
    title: 'Act on a tweet',
    entries: [
      { keys: 'l', what: 'like, or take the like back' },
      { keys: 'b', what: 'bookmark, or take it off' },
      { keys: 'Shift+P', what: 'write a new post' },
      { keys: 'r', what: 'reply' },
      { keys: 't', what: 'repost with your own words' },
      { keys: 'p', what: 'enlarge a photo' },
      { keys: 'v', what: 'play the video' },
      { keys: 'o', what: 'open in your browser' },
      { keys: 'y', what: 'copy the link to the clipboard' },
      { keys: 'Shift+S', what: 'your stats, on and off' },
      { keys: '?', what: 'this popup, on and off' },
      { keys: 'q', what: 'quit' }
    ]
  },
  {
    title: 'Write a reply or a quote',
    entries: [
      { keys: 'Enter', what: 'send' },
      { keys: 'Shift+Enter', what: 'start a new line' },
      { keys: 'Esc', what: 'close and keep the draft' },
      { keys: 'Cmd+V', what: 'paste the clipboard' },
      { keys: '← / →', what: 'move the caret' },
      { keys: 'Alt+← / Alt+→', what: 'jump a word' },
      { keys: 'Home / End', what: 'the two ends of the line' },
      { keys: 'Ctrl+A / Ctrl+E', what: 'the same two ends' },
      { keys: 'Backspace', what: 'take the character before' },
      { keys: 'Delete', what: 'take the character after' }
    ]
  }
]

// The keys of one group all start in the same column, so the descriptions line up.
export const helpColumn = (group: HelpGroup): string => {
  const width = Math.max(...group.entries.map((entry) => entry.keys.length)) + 2
  return group.entries.map((entry) => `${entry.keys.padEnd(width)}${entry.what}`).join('\n')
}

// What the column asks for before the popup shares out what is left. Without it the three
// columns split the row evenly, and the widest one wraps while the narrow ones sit empty.
export const helpColumnWidth = (group: HelpGroup): number =>
  Math.max(group.title.length, ...helpColumn(group).split('\n').map((line) => line.length))

// The title row, the blank row under it, and one row for each key.
const helpGroupRows = (group: HelpGroup): number => group.entries.length + 2

const helpColumnGap = 4

const stackWidth = (stack: readonly HelpGroup[]): number => Math.max(...stack.map(helpColumnWidth))

const packHelpGroups = (count: number): readonly HelpGroup[][] => {
  const stacks: HelpGroup[][] = Array.from({ length: count }, () => [])
  const rows: number[] = Array.from({ length: count }, () => 0)
  for (const group of helpGroups) {
    const shortest = rows.indexOf(Math.min(...rows))
    stacks[shortest]?.push(group)
    rows[shortest] = (rows[shortest] ?? 0) + helpGroupRows(group)
  }
  return stacks
}

// The stacks side by side with the gaps between them, and the rows of the tallest stack.
export const helpContentWidth = (stacks: readonly (readonly HelpGroup[])[]): number =>
  stacks.reduce((total, stack) => total + stackWidth(stack), 0) + helpColumnGap * (stacks.length - 1)

export const helpContentHeight = (stacks: readonly (readonly HelpGroup[])[]): number =>
  Math.max(...stacks.map((stack) => stack.reduce((total, group) => total + helpGroupRows(group), stack.length - 1)))

const helpPadding = 2

// The border, and the padding the card puts on each side of its keys.
const helpChrome = 2 + helpPadding * 2

// The smallest card that still shows every line whole.
export const helpMinCardWidth = (stacks: readonly (readonly HelpGroup[])[]): number =>
  helpContentWidth(stacks) + helpChrome

// Three stacks side by side need a wide terminal. A narrow one gets fewer and taller stacks,
// because a column squeezed below its widest line wraps every description in it.
export const helpStacks = (width: number): readonly (readonly HelpGroup[])[] => {
  for (const count of [3, 2]) {
    const stacks = packHelpGroups(count)
    if (helpMinCardWidth(stacks) <= width) {
      return stacks
    }
  }
  return packHelpGroups(1)
}

const clamp = (value: number, low: number, high: number): number => Math.min(Math.max(value, low), high)

// The card takes most of the window and centres its keys in it. A popup that hugs its own
// text reads as a stray line of output rather than as a window over the app.
const helpWidthShare = 0.8
const helpHeightShare = 0.7

export const helpCardWidth = (terminalWidth: number): number =>
  clamp(Math.round(terminalWidth * helpWidthShare), helpMinCardWidth(helpStacks(terminalWidth)), terminalWidth)

export const helpCardHeight = (terminalWidth: number, terminalHeight: number): number =>
  clamp(
    Math.round(terminalHeight * helpHeightShare),
    helpContentHeight(helpStacks(terminalWidth)) + helpChrome,
    terminalHeight
  )

const statsPadding = 2

// The border, and the padding the card puts on each side of its table.
const statsChrome = 2 + statsPadding * 2

// The stats card takes the size of its table rather than a share of the window: the table
// is a fixed set of columns, and a card wider than them would be a frame around empty space.
export const statsCardWidth = (lines: readonly string[], terminalWidth: number): number =>
  clamp(Math.max(0, ...lines.map((line) => line.length)) + statsChrome, 24, terminalWidth)

export const statsCardHeight = (lines: readonly string[], terminalHeight: number): number =>
  clamp(lines.length + statsChrome, 5, terminalHeight)

// Thirty days plus the head, the total and the notes outrun a short window, so what does
// not fit scrolls, the way the key popup does.
export const statsScrollMaxOf = (lines: readonly string[], terminalHeight: number): number =>
  Math.max(0, lines.length + statsChrome - statsCardHeight(lines, terminalHeight))

// One stack of every key needs about forty rows, which a short terminal does not have. What
// does not fit scrolls, so no key is out of reach on any window.
export const helpScrollMax = (terminalWidth: number, terminalHeight: number): number =>
  Math.max(
    0,
    helpContentHeight(helpStacks(terminalWidth)) + helpChrome - helpCardHeight(terminalWidth, terminalHeight)
  )

// The window pad takes the first row, the header the next three, and the gap under it one,
// so the toast starts on the top row of the pane below and stays clear of the header keys.
export const toastTop = 5

// Its own border and pad on both sides. A line too long for the window is cut, so the box
// never runs off the left edge.
export const toastWidth = (text: string, terminalWidth: number): number =>
  Math.max(10, Math.min(text.length + 4, terminalWidth - 6))

export const createMainScreen = (renderer: CliRenderer, opts: MainScreenOptions = {}): MainScreen => {
  const now = opts.now ?? ((): Date => new Date())
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
  // Every key the app answers used to sit on this row, and each new one pushed the right
  // border off a narrow window. The row now names the one key that shows the rest.
  const headerKeys = new TextRenderable(renderer, {
    id: 'main-header-keys',
    content: helpHint,
    fg: '#58a6ff',
    width: 20,
    height: 1,
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
    // Two columns of border and two of padding leave sixteen, which "● Notifications" fills.
    width: 20,
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
    content: 'Tabs',
    fg: '#f0f6fc',
    width: '100%',
    height: 1
  })
  const railFeeds = new TextRenderable(renderer, {
    id: 'rail-feeds',
    content: '',
    fg: '#8b949e',
    width: '100%',
    height: 6
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

  // The header is also the way into the list, so it is a click target of its own.
  const repliesHeader = new TextRenderable(renderer, {
    id: 'replies-header',
    content: 'Replies',
    fg: '#f0f6fc',
    width: '100%',
    height: 1
  })
  repliesHeader.onMouseDown = () => { opts.onToggleReplies?.() }
  // The replies are cards with avatars, like the timeline, so the same eye reads both.
  const repliesList = new BoxRenderable(renderer, {
    id: 'replies-list',
    width: '100%',
    height: replyCardHeight,
    overflow: 'hidden',
    flexDirection: 'column',
    gap: 1
  })
  // Anchored last so the counts always sit on the bottom row of the pane. The exact date
  // rides on the right of the same row, where a long view count cannot push it off.
  const detailMetricsRow = new BoxRenderable(renderer, {
    id: 'detail-metrics-row',
    width: '100%',
    height: 1,
    flexShrink: 0,
    flexDirection: 'row',
    gap: 1
  })
  const detailMetrics = new TextRenderable(renderer, {
    id: 'detail-metrics',
    content: '',
    fg: '#7d8590',
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    height: 1,
    truncate: true
  })
  const detailPosted = new TextRenderable(renderer, {
    id: 'detail-posted',
    content: '',
    fg: '#7d8590',
    flexShrink: 0,
    width: 0,
    height: 1
  })
  detailMetricsRow.add(detailMetrics)
  detailMetricsRow.add(detailPosted)
  detailPane.add(parentBox)
  detailPane.add(detailAuthorRow)
  detailPane.add(detailBody)
  detailPane.add(mediaText)
  detailPane.add(mediaBox)
  detailPane.add(quoteBox)
  detailPane.add(repliesHeader)
  detailPane.add(repliesList)
  detailPane.add(detailMetricsRow)

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

  // The popup floats over the panes rather than replacing them, so the reader keeps their
  // place in the feed. It is the last child and sits above the rest, because a box that
  // shares the row with the panes would push them aside instead of covering them.
  // The bordered card wants its own size, and an absolute box can only pin an edge, so a
  // box over the whole window that centres one child is what puts the card in the middle.
  const helpPopup = new BoxRenderable(renderer, {
    id: 'help-popup',
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 100,
    shouldFill: false,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    visible: false
  })
  const helpCard = new BoxRenderable(renderer, {
    id: 'help-card',
    width: 1,
    height: 1,
    border: true,
    borderStyle: 'rounded',
    borderColor: '#58a6ff',
    title: ' Keys ',
    titleAlignment: 'center',
    bottomTitle: ' ? or Esc closes ',
    bottomTitleAlignment: 'center',
    backgroundColor: '#0d1117',
    padding: helpPadding,
    // The stacks are as tall as the key list, which a short terminal cannot show at once.
    overflow: 'hidden',
    flexDirection: 'column',
    // The keys keep their own width, so the card can be wider than they are.
    alignItems: 'flex-start'
  })
  // The keys sit in the middle of the card, and a short window scrolls them, both by the
  // margins on this box. A margin is exact, where a centred child that outgrows its parent
  // spills over both edges and loses the start of every line.
  const helpScroller = new BoxRenderable(renderer, {
    id: 'help-scroller',
    width: 1,
    flexShrink: 0,
    flexDirection: 'row',
    gap: helpColumnGap
  })
  helpCard.add(helpScroller)
  helpPopup.add(helpCard)

  let helpStackCount = 0
  // The card is rebuilt only when the terminal changes how many stacks fit, which is rare.
  const layOutHelp = (scroll: number): void => {
    const { terminalWidth, terminalHeight } = renderer
    const stacks = helpStacks(terminalWidth)
    const cardWidth = helpCardWidth(terminalWidth)
    const cardHeight = helpCardHeight(terminalWidth, terminalHeight)
    const contentWidth = helpContentWidth(stacks)
    const contentHeight = helpContentHeight(stacks)
    helpCard.width = cardWidth
    helpCard.height = cardHeight
    helpCard.bottomTitle = helpScrollMax(terminalWidth, terminalHeight) > 0
      ? ' ↑ ↓ scrolls · ? or Esc closes '
      : ' ? or Esc closes '
    helpScroller.width = contentWidth
    helpScroller.height = contentHeight
    helpScroller.marginLeft = Math.max(0, Math.floor((cardWidth - helpChrome - contentWidth) / 2))
    helpScroller.marginTop = Math.max(0, Math.floor((cardHeight - helpChrome - contentHeight) / 2)) - scroll
    if (stacks.length === helpStackCount) {
      return
    }
    helpStackCount = stacks.length
    for (const child of helpScroller.getChildren()) {
      helpScroller.remove(child.id)
    }
    stacks.forEach((groups, index) => {
      const stack = new BoxRenderable(renderer, {
        id: `help-stack-${index}`,
        // The scroller is exactly as wide as its stacks, so a stack takes its own width and
        // neither grows nor shrinks. A squeezed stack wraps every description in it.
        width: Math.max(...groups.map(helpColumnWidth)),
        flexShrink: 0,
        height: '100%',
        flexDirection: 'column',
        gap: 1
      })
      for (const group of groups) {
        const slug = group.title.split(' ')[0]?.toLowerCase() ?? group.title
        const column = new BoxRenderable(renderer, {
          id: `help-column-${slug}`,
          width: '100%',
          flexShrink: 0,
          flexDirection: 'column',
          gap: 1
        })
        column.add(new TextRenderable(renderer, {
          id: `help-column-title-${slug}`,
          content: group.title,
          fg: '#58a6ff',
          width: '100%',
          height: 1,
          truncate: true
        }))
        column.add(new TextRenderable(renderer, {
          id: `help-column-body-${slug}`,
          content: helpColumn(group),
          fg: '#c9d1d9',
          width: '100%',
          height: group.entries.length
        }))
        stack.add(column)
      }
      helpScroller.add(stack)
    })
  }
  helpPopup.onMouseDown = () => { opts.onCloseHelp?.() }

  // The stats page floats the same way the key popup does, and for the same reason: the
  // feed keeps its place while the numbers are read.
  const statsPopup = new BoxRenderable(renderer, {
    id: 'stats-popup',
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 100,
    shouldFill: false,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    visible: false
  })
  const statsCard = new BoxRenderable(renderer, {
    id: 'stats-card',
    width: 1,
    height: 1,
    border: true,
    borderStyle: 'rounded',
    borderColor: '#58a6ff',
    title: ' Stats ',
    titleAlignment: 'center',
    bottomTitle: ' w changes the window · Esc closes ',
    bottomTitleAlignment: 'center',
    backgroundColor: '#0d1117',
    padding: statsPadding,
    overflow: 'hidden',
    flexDirection: 'column',
    alignItems: 'flex-start'
  })
  const statsText = new TextRenderable(renderer, {
    id: 'stats-text',
    content: '',
    fg: '#c9d1d9',
    width: 1,
    height: 1,
    flexShrink: 0
  })
  statsCard.add(statsText)
  statsPopup.add(statsCard)
  statsPopup.onMouseDown = () => { opts.onCloseStats?.() }

  // A copy leaves nothing on the screen to show for itself. The corner says so for a moment
  // and then goes, rather than the status line, which sits on the far bottom row.
  const toastBox = new BoxRenderable(renderer, {
    id: 'toast',
    position: 'absolute',
    top: toastTop,
    // An absolute box measures from the window edge, not from the pad inside it, so the
    // right edge takes that one column back and lands on the border of the pane.
    right: 1,
    zIndex: 90,
    width: 1,
    height: 3,
    border: true,
    borderStyle: 'rounded',
    borderColor: '#3fb950',
    backgroundColor: '#0d1117',
    paddingX: 1,
    visible: false
  })
  const toastText = new TextRenderable(renderer, {
    id: 'toast-text',
    content: '',
    fg: '#3fb950',
    width: '100%',
    height: 1,
    truncate: true
  })
  toastBox.add(toastText)

  shell.add(header)
  shell.add(body)
  shell.add(lightbox)
  shell.add(composer)
  shell.add(status)
  shell.add(toastBox)
  shell.add(helpPopup)
  shell.add(statsPopup)
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
  // Either popup covers the panes, and a picture is painted over the grid rather than into
  // it, so both have to stop every picture the same way.
  let popupOpen = false
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

  // The list only draws inside its own view; the rows it leaves stay blank behind the tweet.
  const renderReplyCards = (state: AppState, rows: number, open: boolean): void => {
    clearReplyCards()
    replySlots = []
    if (!open) {
      return
    }
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
    // A strip too short for a whole card would draw it as a clipped sliver, so it falls back to
    // one line for each reply. Fewer words, but the reader still sees who answered.
    const compact = rows < replyCardHeight
    repliesList.gap = compact ? 0 : 1
    const capacity = compact ? Math.max(1, rows) : replyCapacity(rows)
    replyTop = scrollWindow(ids.length, ids.indexOf(state.selectedDetailId ?? ''), capacity, replyTop)
    for (const id of ids.slice(replyTop, replyTop + capacity)) {
      const reply = state.tweets[id]
      if (!reply) {
        continue
      }
      const selected = id === state.selectedDetailId
      if (compact) {
        const line = new TextRenderable(renderer, {
          id: `reply-line-${id}`,
          content: replyLine(reply, selected),
          fg: selected ? '#58a6ff' : '#c9d1d9',
          width: '100%',
          height: 1,
          truncate: true
        })
        line.onMouseDown = () => { opts.onOpenTweet?.(id) }
        repliesList.add(line)
        replyCards.push(line)
        continue
      }
      const card = cardBox(renderer, `reply-card-${id}`, selected)
      const avatar = new BoxRenderable(renderer, { id: `reply-card-${id}-avatar`, width: avatarCols, height: avatarRows })
      const column = new BoxRenderable(renderer, { id: `reply-card-${id}-column`, flexGrow: 1, height: '100%', flexDirection: 'column' })
      column.add(authorRow(renderer, {
        id: `reply-card-${id}-author`,
        author: `${articlePill(reply)}${repostPill(reply)}${reply.author.name}${reply.author.verified ? ' ✔' : ''}  @${reply.author.handle}${reply.quotedTweet ? '  quote' : ''}`,
        posted: relativeTime(reply.createdAt, now()),
        fg: selected ? '#58a6ff' : '#f0f6fc'
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

  const emptyCard = (id: string, text: string): void => {
    const empty = cardBox(renderer, id, false)
    empty.add(new TextRenderable(renderer, { id: `${id}-text`, content: text, fg: '#8b949e', width: '100%', height: 1 }))
    timelineCards.add(empty)
    cards.push(empty)
  }

  // Both lists draw the same card, so the timeline and the notifications tab build it here. A
  // post opened out of a notice line steps in, the way x.com lists it under its heading.
  const addTweetCard = (id: string, tweet: AppTweet, selected: boolean, nested = false): void => {
    const card = cardBox(renderer, `tweet-card-${id}`, selected)
    if (nested) {
      // A width of 100% plus a margin is wider than the pane, so the card stretches instead.
      card.marginLeft = 2
      card.width = 'auto'
    }
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
    column.add(authorRow(renderer, {
      id: `tweet-card-${id}-author`,
      author: `${articlePill(tweet)}${repostPill(tweet)}${tweet.author.name}${tweet.author.verified ? ' ✔' : ''}  @${tweet.author.handle}${mediaPill}`,
      posted: relativeTime(tweet.createdAt, now()),
      fg: selected ? '#58a6ff' : '#f0f6fc'
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

  // A notice says what happened; the tweet under it says what it happened to. A notice X sent
  // about nothing this app can open, such as a post alert, keeps the second line empty.
  const addNoticeCard = (row: NotificationRow, tweet: AppTweet | undefined, selected: boolean, opened = false): void => {
    const notice = row.notice
    if (!notice) {
      return
    }
    const id = `notice-card-${row.key}`
    const card = cardBox(renderer, id, selected)
    const avatar = new BoxRenderable(renderer, { id: `${id}-avatar`, width: avatarCols, height: avatarRows })
    const column = new BoxRenderable(renderer, { id: `${id}-column`, flexGrow: 1, height: '100%', flexDirection: 'column' })
    // X writes a whole sentence, so it takes the two rows a tweet gives its text, and the tweet
    // takes the one row a name and a handle give theirs. The stamp keeps the top right corner it
    // has on a tweet card, and the sentence wraps in what is left.
    const stamp = relativeTime(notice.createdAt, now())
    const head = new BoxRenderable(renderer, { id: `${id}-head`, width: '100%', height: 2, flexShrink: 0, flexDirection: 'row', gap: 1 })
    head.add(new TextRenderable(renderer, {
      id: `${id}-text`,
      content: `${noticeGlyph(notice.icon)} ${decodeEntities(notice.text).replaceAll('\n', ' ')}`,
      fg: selected ? '#58a6ff' : '#f0f6fc',
      flexGrow: 1,
      flexShrink: 1,
      minWidth: 0,
      height: 2,
      wrapMode: 'word'
    }))
    if (stamp !== '') {
      head.add(new TextRenderable(renderer, { id: `${id}-posted`, content: stamp, fg: '#7d8590', flexShrink: 0, width: stamp.length, height: 1 }))
    }
    column.add(head)
    column.add(new TextRenderable(renderer, {
      id: `${id}-body`,
      content: tweet ? decodeEntities(tweet.text).replaceAll('\n', ' ') : '',
      fg: '#8b949e',
      width: '100%',
      height: 1,
      truncate: true
    }))
    column.add(new TextRenderable(renderer, {
      id: `${id}-metrics`,
      content: tweet ? cardMetrics(tweet) : noticeHint(notice, opened),
      fg: '#7d8590',
      width: '100%',
      height: 1
    }))
    card.add(avatar)
    card.add(column)
    if (row.tweetId !== undefined) {
      card.onMouseDown = () => { opts.onOpenTweet?.(row.tweetId ?? '') }
    }
    timelineCards.add(card)
    cards.push(card)
    if (notice.avatarUrl) {
      slots.push({ key: `avatar:notice:${row.key}`, url: notice.avatarUrl, box: avatar, pane: timelineCards, width: 1, height: 1, minCols: avatarCols, minRows: avatarRows })
    }
  }

  const renderNotificationCards = (state: AppState): void => {
    const { rows, loading } = state.notifications
    const capacity = cardCapacity(timelineCards.height)
    scrollTop = scrollWindow(rows.length, rows.findIndex((row) => row.key === state.selectedRowKey), capacity, scrollTop)
    const visible = rows.slice(scrollTop, scrollTop + capacity)
    if (visible.length === 0) {
      emptyCard('timeline-empty', loading ? 'Loading notifications…' : 'No notifications yet.')
      return
    }
    for (const row of visible) {
      const tweet = row.tweetId !== undefined ? state.tweets[row.tweetId] : undefined
      const selected = row.key === state.selectedRowKey
      if (row.notice) {
        addNoticeCard(row, tweet, selected, rows.some((other) => other.parentKey === row.key))
        continue
      }
      if (tweet) {
        // A row keys its own card, because the same post can stand under two notice lines.
        addTweetCard(row.key, tweet, selected, row.parentKey !== undefined)
      }
    }
  }

  const renderCards = (state: AppState): void => {
    clearCards()
    slots = []
    const timeline = activeTimeline(state)
    if (!timeline) {
      renderNotificationCards(state)
      return
    }
    const capacity = cardCapacity(timelineCards.height)
    scrollTop = scrollWindow(timeline.tweetIds.length, timeline.tweetIds.indexOf(state.selectedTweetId ?? ''), capacity, scrollTop)
    const visibleIds = timeline.tweetIds.slice(scrollTop, scrollTop + capacity)
    if (visibleIds.length === 0) {
      emptyCard('timeline-empty', timeline.loading ? 'Loading feed…' : 'No tweets loaded yet.')
      return
    }
    for (const id of visibleIds) {
      const tweet = state.tweets[id]
      if (tweet) {
        addTweetCard(id, tweet, id === state.selectedTweetId)
      }
    }
  }

  return {
    render(state: AppState, auth?: AuthStatus) {
      const focused = focusedTweet(state)
      const timeline = activeTimeline(state)
      body.visible = state.lightbox === undefined
      lightbox.visible = state.lightbox !== undefined
      if (state.helpOpen) {
        layOutHelp(state.helpScroll)
      }
      helpPopup.visible = state.helpOpen
      popupOpen = state.helpOpen || state.stats.open
      statsPopup.visible = state.stats.open
      if (state.stats.open) {
        const lines = statsBodyLines({ ...state.stats, window: state.stats.window, now: now() })
        const cardWidth = statsCardWidth(lines, renderer.terminalWidth)
        const cardHeight = statsCardHeight(lines, renderer.terminalHeight)
        statsCard.width = cardWidth
        statsCard.height = cardHeight
        statsCard.bottomTitle = statsScrollMaxOf(lines, renderer.terminalHeight) > 0
          ? ' ↑ ↓ scrolls · w changes the window · Esc closes '
          : ' w changes the window · Esc closes '
        statsText.content = lines.join('\n')
        statsText.width = cardWidth - statsChrome
        statsText.height = lines.length
        statsText.marginTop = -state.stats.scroll
      }
      lightboxCaption.content = state.lightbox ? `${state.lightbox.label} · click or Esc to close` : ''
      lightboxSlot = state.lightbox
        ? { key: state.lightbox.key, url: state.lightbox.url, box: lightboxImage, pane: lightbox, width: state.lightbox.width, height: state.lightbox.height, minRows: mediaFloor }
        : undefined
      // X retired the v1.1 account endpoints, so a cookie session cannot resolve its own handle.
      const handle = auth?.ok && auth.username ? `@${auth.username}` : 'cookie session'
      headerMeta.content = headerLine(auth?.ok ? handle : 'auth pending', state)
      const railLines = railTabs(state)
      railFeeds.content = railLines
      // The rail grows a row per tab the reader adds, so its height comes from what it holds.
      railFeeds.height = railLines.split('\n').length
      railProfile.content = auth?.ok ? `Signed in\n${handle}\n\n${auth.name ?? ''}` : 'Checking credentials…'
      timelineHeader.content = timeline
        ? timelineTitle(state, timeline.id, timeline.tweetIds.length)
        : notificationsTitle(state.notifications)
      // A new tweet always starts at its first line, never at the old offset.
      if (focused?.id !== detailTweetId) {
        detailTweetId = focused?.id
        detailScroll = 0
      }
      detailAuthorName.content = focused ? `${focused.author.name}${focused.author.verified ? ' ✔' : ''}` : ''
      detailAuthorHandle.content = focused ? `${articlePill(focused)}@${focused.author.handle}${postedPill(focused, now())}${focused.repostedBy ? `  ·  ↻ ${focused.repostedBy.name} reposted` : ''}` : ''
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
      // The reply list takes the whole pane, so everything the tweet draws stands down
      // while it is up rather than share the rows with it.
      const listOpen = repliesOpen(state)
      const layout = detailLayout(detailPane.height, { photo: photo !== undefined, quote: quoted !== undefined, quotePhoto: quotePhoto !== undefined, parent: parent !== undefined, textLines: flowRows(detailItems), article: focused?.article !== undefined, repliesOpen: listOpen })
      // The row budget only exists once the layout is out, so the flow is built again with
      // pictures that fit inside it. An article body always overflows, so the budget itself
      // does not move.
      const cap = bodyImageCap(layout.text)
      if (cap !== articleImageCap && detailItems.some((item) => item.kind === 'image')) {
        detailItems = detailFlow(focused, detailBody.width, cell, 'Select a tweet with j/k.', cap)
      }
      detailBody.visible = !listOpen
      detailBody.height = layout.text
      detailScroll = clampFlowScroll(detailItems, detailScroll, layout.text)
      // The arrows own the text now, so it brightens the way a selected card does.
      renderBody(flowBlock(detailItems, detailScroll, layout.text, state.textFocused), state.textFocused)
      detailHints.content = listOpen
        ? repliesHint(focused, state.detailStack.length)
        : detailHint(focused, state.detailStack.length, parent !== undefined, { scrolls: flowRows(detailItems) > layout.text, focused: state.textFocused })
      const parentSelected = parent !== undefined && parent.id === state.selectedDetailId
      parentBox.visible = parent !== undefined && !listOpen
      parentBox.height = layout.parent
      parentBox.borderColor = parentSelected ? '#58a6ff' : '#30363d'
      parentBox.backgroundColor = parentSelected ? '#111b2b' : '#0d1117'
      parentAuthor.content = parent ? `↩ Replying to ${parent.author.name}${parent.author.verified ? ' ✔' : ''}  @${parent.author.handle}${postedPill(parent, now())}` : ''
      parentAuthor.fg = parentSelected ? '#58a6ff' : '#f0f6fc'
      parentText.content = parent ? decodeEntities(parent.text).replaceAll('\n', ' ') : ''
      parentAvatarSlot = parent?.author.avatarUrl && layout.parent > 0
        ? { key: `avatar:parent:${parent.id}`, url: parent.author.avatarUrl, box: parentAvatar, pane: parentBox, width: 1, height: 1, minCols: avatarCols, minRows: avatarRows }
        : undefined
      parentBox.onMouseDown = parent ? () => { opts.onOpenTweet?.(parent.id) } : undefined
      detailMetrics.content = focused ? metricsLine(focused) : ''
      const postedStamp = focused ? absoluteTime(focused.createdAt) : ''
      detailPosted.content = postedStamp
      detailPosted.width = postedStamp.length
      repliesList.height = layout.replies
      // An empty image box would still claim its share of the pane, so hide it.
      mediaText.visible = !listOpen
      mediaBox.visible = layout.media > 0
      mediaBox.height = layout.media
      mediaTiles = renderTiles(mediaTiles, { box: mediaBox, pane: detailPane, id: 'detail-media-tile', source: 'tweet', tweet: focused, visible: layout.media > 0 })
      quoteBox.visible = quoted !== undefined && !listOpen
      quoteBox.height = layout.quote
      const quoteMediaRows = layout.quote - quoteRows
      quoteMediaBox.visible = quotePhoto !== undefined && quoteMediaRows > 0
      quoteAuthor.content = quoted ? `${quoted.author.name}${quoted.author.verified ? ' ✔' : ''}  @${quoted.author.handle}${postedPill(quoted, now())}` : ''
      quoteText.content = quoted ? decodeEntities(quoted.text).replaceAll('\n', ' ') : ''
      // A hidden card keeps the size it last measured, so the avatar has to go with it or
      // it would paint over the replies.
      quoteAvatarSlot = quoted?.author.avatarUrl && layout.quote > 0
        ? { key: `avatar:${quoted.id}`, url: quoted.author.avatarUrl, box: quoteAvatar, pane: quoteBox, width: 1, height: 1, minCols: avatarCols, minRows: avatarRows }
        : undefined
      quoteTiles = renderTiles(quoteTiles, { box: quoteMediaBox, pane: quoteBox, id: 'detail-quote-tile', source: 'quote', tweet: quoted, visible: quoteMediaRows > 0 })
      const replyIds = replyIdsOf(state)
      repliesHeader.content = listOpen
        ? repliesTitle(replyIds.length, state.selectedDetailId ? replyIds.indexOf(state.selectedDetailId) : -1)
        : repliesClosedTitle(replyIds.length)
      repliesHeader.fg = listOpen ? '#f0f6fc' : '#58a6ff'
      renderReplyCards(state, layout.replies, listOpen)
      composer.visible = state.composer.open
      composerTitle.content = composerHeading(state)
      // The drawer is measured only after it is drawn, so the shell gives the width until then:
      // its own pad, then the border and the pad of the drawer.
      const composerWidth = composerText.width > 0 ? composerText.width : renderer.terminalWidth - 6
      const drawer = composerBody(state.composer.draft, state.composer.error, composerWidth, state.composer.caret)
      composer.height = drawer.height
      composerText.content = drawer.text
      caret = state.composer.open ? { row: drawer.caretRow, col: drawer.caretCol } : undefined
      const toast = state.toast
      toastBox.visible = toast !== undefined
      if (toast !== undefined) {
        toastText.content = toast
        toastBox.width = toastWidth(toast, renderer.terminalWidth)
      }
      statusText.content = state.status
      statusText.fg = state.status.includes('error') || state.status.includes('failed') ? '#ff7b72' : '#7d8590'
      renderCards(state)
      renderer.requestRender()
    },
    placements() {
      const cell = cellSize(renderer.resolution, renderer.terminalWidth, renderer.terminalHeight, process.env.TWEETER_CELL_PX)
      // A picture is painted on top of the terminal grid, not into it, so an avatar under
      // the popup would show through it. The popup owns the screen while it is open.
      if (popupOpen) {
        return []
      }
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
    statsScrollMax(state: AppState) {
      const lines = statsBodyLines({ ...state.stats, now: now() })
      return statsScrollMaxOf(lines, renderer.terminalHeight)
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

// The name and the handle already fill a card line, so an appended stamp is the first
// thing truncate throws away. The stamp gets its own cell instead, and only the name gives
// ground when the card is narrow.
const authorRow = (
  renderer: CliRenderer,
  args: { id: string; author: string; posted: string; fg: string }
): BoxRenderable => {
  const row = new BoxRenderable(renderer, { id: args.id, width: '100%', height: 1, flexShrink: 0, flexDirection: 'row', gap: 1 })
  row.add(new TextRenderable(renderer, {
    id: `${args.id}-text`,
    content: args.author,
    fg: args.fg,
    flexGrow: 1,
    // Yoga defaults flexShrink to 0, not to the CSS 1, so a long name would push the stamp
    // off the row instead of giving ground to it.
    flexShrink: 1,
    minWidth: 0,
    height: 1,
    truncate: true
  }))
  if (args.posted !== '') {
    // Yoga measures a text box from its content and then shrinks it anyway, so the stamp
    // states its own width. Without it "5d" reaches the screen as "5".
    row.add(new TextRenderable(renderer, {
      id: `${args.id}-posted`,
      content: args.posted,
      fg: '#7d8590',
      flexShrink: 0,
      width: args.posted.length,
      height: 1
    }))
  }
  return row
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

// The detail pane is wide, so the stamp rides on the line that already carries the handle.
// A tweet X sent without a date says nothing rather than an empty separator.
export const postedPill = (tweet: AppTweet | undefined, now: Date): string => {
  const stamp = relativeTime(tweet?.createdAt, now)
  return stamp === '' ? '' : `  ·  ${stamp}`
}

// x.com fills the heart on a tweet you have liked. A count alone cannot show that, so the
// filled glyph carries it here.
export const likeCount = (tweet: AppTweet): string =>
  `${tweet.favorited === true ? '♥ ' : ''}${tweet.metrics.likes ?? 0} likes`

// A bookmark is private, so the count says little and the card is narrow. The card shows
// only whether this reader holds one; the detail pane below carries the number.
export const bookmarkCount = (tweet: AppTweet): string =>
  `${tweet.bookmarked === true ? '⚑ ' : ''}${tweet.metrics.bookmarks ?? 0} bookmarks`

const cardMetrics = (tweet: AppTweet): string =>
  `${tweet.metrics.replies ?? 0} replies   ${tweet.metrics.reposts ?? 0} reposts   ${likeCount(tweet)}${tweet.bookmarked === true ? '   ⚑' : ''}`

// A tab the reader made is named by the query it holds; the three fixed tabs carry their
// own names.
export const tabName = (state: AppState, tab: TabId): string => {
  const query = searchQueryOf(state, tab)
  if (query !== undefined) {
    return query
  }
  if (tab === 'following') {
    return 'Following'
  }
  return tab === 'forYou' ? 'For You' : 'Notifications'
}

export const sortName = (sort: FeedSort): string => (sort === 'popular' ? 'Popular' : 'Recent')

// Only Following can be sorted, so naming a sort on For You or on a search would promise a
// control the key does not give there.
export const timelineTitle = (state: AppState, tab: TimelineId, count: number): string => {
  const sortLabel = tab === 'following' ? `${sortName(state.feedSort)} · ` : ''
  return `${tabName(state, tab)} · ${sortLabel}${count} tweets`
}

// A row is a mention or an aggregated line, so "tweets" would be the wrong word. The unread
// count comes from x.com and only x.com clears it, so it is named as what x.com still holds.
export const notificationsTitle = (notifications: NotificationsState): string => {
  const unread = notifications.unread > 0 ? ` · ${notifications.unread} unread` : ''
  return `Notifications · ${notifications.rows.length} rows${unread}`
}

// The rail is sixteen columns wide inside its border, which "○ Notifications" fills exactly.
// A query longer than that is cut rather than wrapped, because a wrapped line would read as
// a tab of its own.
const railLabelWidth = 14

export const railLabel = (name: string): string =>
  name.length > railLabelWidth ? `${name.slice(0, railLabelWidth - 1)}…` : name

// The dot marks the open tab. The tabs the reader made come after the fixed ones, in the
// order they were added.
export const railTabs = (state: AppState): string => {
  const lines = tabOrder(state).map((tab) => `${state.activeTab === tab ? '●' : '○'} ${railLabel(tabName(state, tab))}`)
  return [...lines, '', 'Tab switches', 's sorts', '/ adds a tab', 'D closes one'].join('\n')
}

// The count x.com still holds, on every tab, so the reader sees there is something new
// without switching to look.
export const headerLine = (who: string, state: AppState): string => {
  const unread = state.notifications.unread > 0 ? ` · ${state.notifications.unread} unread` : ''
  return `${who} · ${tabName(state, state.activeTab)}${unread}`
}

// x.com draws a heart, a repost arrow or a bell beside each line. One glyph carries the same
// thing here, because the sentence beside it never names the kind of event.
export const noticeGlyph = (icon: NoticeIcon): string => {
  if (icon === 'like') {
    return '♥'
  }
  if (icon === 'repost') {
    return '↻'
  }
  if (icon === 'follow') {
    return '⊕'
  }
  return icon === 'bell' ? '◆' : '•'
}

// A line that stands for a list has no counts to show on its last row, so the row says what
// the key does instead. x.com puts the same words over the page it opens.
export const noticeHint = (notice: AppNotice, opened: boolean): string => {
  if (!notice.list) {
    return ''
  }
  return `${opened ? 'Enter closes' : 'Enter opens'} ${notice.list.title}`
}

// One reply on one row, for a strip with no room for a card. The marker is what the border
// says on a card: this is the one the arrows are on.
export const replyLine = (reply: AppTweet, selected: boolean): string =>
  `${selected ? '▸' : ' '} @${reply.author.handle}  ${decodeEntities(reply.text).replaceAll('\n', ' ')}`

// The header of the open list. It carries the way out as well, because the list covers the
// tweet it belongs to.
export const repliesTitle = (total: number, index: number): string => {
  if (total === 0) {
    return 'Replies  ·  ← closes them'
  }
  const position = index >= 0 ? `${index + 1}/${total}  ·  Shift+→ opens it` : `${total}  ·  ↑/↓ picks one`
  return `Replies · ${position}  ·  ← closes them`
}

// While the list is shut the tweet holds the whole pane, so this line is the way in.
export const repliesClosedTitle = (total: number): string =>
  `Replies${total > 0 ? ` · ${total}` : ''}  ·  click or → opens them`

// The list stands where the tweet was, so the hint line names the keys of the list rather
// than what the tweet under it offers.
export const repliesHint = (tweet: AppTweet | undefined, depth: number): string => {
  if (!tweet) {
    return 'Select a tweet with j/k.'
  }
  const parts = ['↑/↓ walks the replies', 'Shift+→ opens one', '← back to the tweet']
  if (depth > 0) {
    parts.push(`depth ${depth}  ·  Shift+← back`)
  }
  return parts.join('  ·  ')
}

const composerLead = (mode: ComposerMode, who: string): string => {
  if (mode === 'post') {
    return 'New post'
  }
  return mode === 'quote' ? `Quoting ${who}` : `Replying to ${who}`
}

// The search prompt borrows the drawer, so it borrows this heading too. It counts no
// characters, because X takes a query of any length.
export const composerHeading = (state: AppState): string => {
  if (state.composer.mode === 'search') {
    return 'New tab · type a search · Enter opens it · Esc closes'
  }
  const id = state.composer.targetTweetId
  const target = id ? state.tweets[id] : undefined
  const who = target ? `@${target.author.handle}` : (id ?? 'tweet')
  const lead = composerLead(state.composer.mode, who)
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
  // The row is already tight and X leaves the bookmark count out of most timelines, so it
  // earns its place only when there is something to say.
  if (tweet.metrics.bookmarks !== undefined || tweet.bookmarked === true) {
    counts.push(bookmarkCount(tweet))
  }
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
