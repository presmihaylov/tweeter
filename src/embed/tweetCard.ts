// The tweet card, on its own. mainScreen drew it inline for a long time; it lives here
// so another app can put the same card on screen instead of drawing a lookalike. Nothing
// here reads the app's state: a card is a renderer, a tweet and a clock.
import { BoxRenderable, TextRenderable, type CliRenderer } from '@opentui/core'

import { fitCells } from '../media/geometry.ts'
import type { CellSize, ImagePlacement } from '../media/imageLayer.ts'
import type { AppTweet } from '../twitter/types.ts'
import { relativeTime } from '../utils/time.ts'

// Reserved cells; toPlacement shrinks this to the largest square the font metrics allow.
export const avatarCols = 7
export const avatarRows = 3
export const cardHeight = 6

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

// A bookmark is private, so the count says little and the card is narrow. The card shows
// only whether this reader holds one; the detail pane below carries the number.
export const bookmarkCount = (tweet: AppTweet): string =>
  `${tweet.bookmarked === true ? '⚑ ' : ''}${tweet.metrics.bookmarks ?? 0} bookmarks`

export const cardMetrics = (tweet: AppTweet): string =>
  `${tweet.metrics.replies ?? 0} replies   ${tweet.metrics.reposts ?? 0} reposts   ${likeCount(tweet)}${tweet.bookmarked === true ? '   ⚑' : ''}`

// The name line as x.com writes it: what kind of post this is, who wrote it, their handle,
// and what the card wants to add after it.
export const cardAuthorLine = (tweet: AppTweet, trailing = ''): string =>
  `${articlePill(tweet)}${repostPill(tweet)}${tweet.author.name}${tweet.author.verified ? ' ✔' : ''}  @${tweet.author.handle}${trailing}`

// What the card wants drawn on top of it once the layout has run: a picture cannot be a
// Renderable, so the box only reserves the cells and the image layer fills them.
export type ImageSlot = {
  key: string
  url: string
  box: BoxRenderable
  pane: BoxRenderable
  width?: number
  height?: number
  minCols?: number
  minRows?: number
}

export const authorRow = (
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

export const cardBox = (renderer: CliRenderer, id: string, selected: boolean): BoxRenderable => {
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
export const toPlacement = (
  slot: ImageSlot,
  shape: 'circle' | 'rect',
  cell: CellSize,
  renderer: CliRenderer
): ImagePlacement | undefined => {
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

export type TweetCardOptions = {
  id: string
  tweet: AppTweet
  selected?: boolean
  /** Appended to the name line, after the handle. The timeline lists media here. */
  trailing?: string
  now?: Date
}

export type TweetCard = {
  /** Add this to a pane. It is a whole card, borders and all. */
  card: BoxRenderable
  /** The cells the avatar was promised. Empty until the image layer paints them. */
  avatar: BoxRenderable
}

/**
 * One tweet, drawn the way tweeter's timeline draws it: avatar, name and handle, the
 * stamp, two rows of text and the metrics line. Give the card a pane and pass
 * `avatarSlot` to an image layer to get the picture on top of it.
 */
export const tweetCard = (renderer: CliRenderer, opts: TweetCardOptions): TweetCard => {
  const { id, tweet } = opts
  const selected = opts.selected === true
  const card = cardBox(renderer, `tweet-card-${id}`, selected)
  const avatar = new BoxRenderable(renderer, { id: `tweet-card-${id}-avatar`, width: avatarCols, height: avatarRows })
  const column = new BoxRenderable(renderer, {
    id: `tweet-card-${id}-column`,
    flexGrow: 1,
    height: '100%',
    flexDirection: 'column'
  })
  column.add(authorRow(renderer, {
    id: `tweet-card-${id}-author`,
    author: cardAuthorLine(tweet, opts.trailing ?? ''),
    posted: relativeTime(tweet.createdAt, opts.now ?? new Date()),
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
  return { card, avatar }
}

/** The slot that puts the author's picture on a card built by `tweetCard`. */
export const avatarSlot = (
  id: string,
  tweet: AppTweet,
  built: TweetCard,
  pane: BoxRenderable
): ImageSlot | undefined =>
  tweet.author.avatarUrl
    ? { key: `avatar:${id}`, url: tweet.author.avatarUrl, box: built.avatar, pane, width: 1, height: 1, minCols: avatarCols, minRows: avatarRows }
    : undefined
