import { describe, expect, test } from 'bun:test'
import { cardCapacity, detailLayout, scrollWindow } from '../src/app/mainScreen.ts'

// The fixed rows are the author block (3), the media caption, the replies header and the
// metrics bar. Three blank rows set the text, the replies and the metrics bar apart, and a
// quote card pays for a fourth. While the list is shut, `replies` is the blank strip that
// holds the metrics bar on the bottom row.
const sum = (layout: { parent: number; text: number; media: number; quote: number; replies: number }, quote: boolean): number =>
  layout.parent + layout.text + layout.media + layout.quote + layout.replies + 6 + 3 + (quote ? 1 : 0)

// The open list keeps the author block, its header and the metrics bar, and nothing else.
const repliesViewChrome = 11

describe('timeline window', () => {
  test('fits whole cards plus their gaps', () => {
    expect(cardCapacity(27)).toBe(4)
    expect(cardCapacity(26)).toBe(3)
    expect(cardCapacity(6)).toBe(1)
    expect(cardCapacity(1)).toBe(1)
  })

  test('assumes a fixed page before the pane is laid out', () => {
    expect(cardCapacity(0)).toBe(8)
  })

  test('keeps the top still while the selection stays on the page', () => {
    expect(scrollWindow(100, 2, 4, 0)).toBe(0)
    expect(scrollWindow(100, 3, 4, 0)).toBe(0)
  })

  test('scrolls down by one when the selection passes the last card', () => {
    expect(scrollWindow(100, 4, 4, 0)).toBe(1)
    expect(scrollWindow(100, 9, 4, 0)).toBe(6)
  })

  test('scrolls up to the selection when it moves above the page', () => {
    expect(scrollWindow(100, 3, 4, 6)).toBe(3)
  })

  test('never scrolls past the last page', () => {
    expect(scrollWindow(5, 4, 4, 40)).toBe(1)
    expect(scrollWindow(3, 0, 4, 2)).toBe(0)
  })

  test('holds the clamped top when nothing is selected', () => {
    expect(scrollWindow(100, -1, 4, 5)).toBe(5)
  })
})

describe('detail layout', () => {
  test('keeps rows for the photo when a quote card is also shown', () => {
    const layout = detailLayout(34, { photo: true, quote: true, quotePhoto: false, parent: false, textLines: 4 })
    expect(layout).toEqual({ parent: 0, text: 4, media: 11, quote: 5, replies: 0 })
    expect(sum(layout, true)).toBe(34 - 4)
  })

  test('gives the photo every surplus row', () => {
    const layout = detailLayout(34, { photo: true, quote: false, quotePhoto: false, parent: false, textLines: 4 })
    expect(layout).toEqual({ parent: 0, text: 4, media: 17, quote: 0, replies: 0 })
    expect(sum(layout, false)).toBe(34 - 4)
  })

  test('prefers the tweet photo over the quoted photo when rows are scarce', () => {
    const layout = detailLayout(28, { photo: true, quote: true, quotePhoto: true, parent: false, textLines: 4 })
    expect(layout).toEqual({ parent: 0, text: 4, media: 5, quote: 5, replies: 0 })
    expect(sum(layout, true)).toBe(28 - 4)
  })

  test('reserves extra rows for the quoted photo once the pane is tall enough', () => {
    const layout = detailLayout(40, { photo: true, quote: true, quotePhoto: true, parent: false, textLines: 4 })
    expect(layout).toEqual({ parent: 0, text: 4, media: 13, quote: 9, replies: 0 })
    expect(sum(layout, true)).toBe(40 - 4)
  })

  // The rows a short tweet cannot use went blank under the photo. Nothing waits under it,
  // so the photo takes them instead of the blank.
  test('hands the photo the rows a short tweet cannot use', () => {
    const layout = detailLayout(50, { photo: true, quote: false, quotePhoto: false, parent: false, textLines: 4 })
    expect(layout).toEqual({ parent: 0, text: 4, media: 33, quote: 0, replies: 0 })
    expect(sum(layout, false)).toBe(50 - 4)
  })

  test('keeps the photo on a short pane with a quote card', () => {
    const layout = detailLayout(30, { photo: true, quote: true, quotePhoto: false, parent: false, textLines: 4 })
    expect(layout).toEqual({ parent: 0, text: 4, media: 7, quote: 5, replies: 0 })
    expect(sum(layout, true)).toBe(30 - 4)
  })

  test('drops a photo that would render as a sliver and gives the rows to the text', () => {
    const layout = detailLayout(24, { photo: true, quote: true, quotePhoto: true, parent: false, textLines: 4 })
    expect(layout).toEqual({ parent: 0, text: 4, media: 0, quote: 5, replies: 1 })
    expect(sum(layout, true)).toBe(24 - 4)
  })

  test('leaves the rows a short tweet cannot use blank', () => {
    const layout = detailLayout(31, { photo: false, quote: false, quotePhoto: false, parent: false, textLines: 4 })
    expect(layout).toEqual({ parent: 0, text: 4, media: 0, quote: 0, replies: 14 })
    expect(sum(layout, false)).toBe(31 - 4)
  })

  test('gives a long tweet the rows the photo leaves over', () => {
    const layout = detailLayout(50, { photo: true, quote: false, quotePhoto: false, parent: false, textLines: 40 })
    expect(layout).toEqual({ parent: 0, text: 25, media: 12, quote: 0, replies: 0 })
    expect(sum(layout, false)).toBe(50 - 4)
  })

  test('holds the text at its floor when the tweet is one line', () => {
    const layout = detailLayout(50, { photo: true, quote: false, quotePhoto: false, parent: false, textLines: 1 })
    expect(layout).toEqual({ parent: 0, text: 3, media: 34, quote: 0, replies: 0 })
    expect(sum(layout, false)).toBe(50 - 4)
  })

  test('a long tweet with nothing under it takes the whole pane', () => {
    const layout = detailLayout(31, { photo: false, quote: false, quotePhoto: false, parent: false, textLines: 40 })
    expect(layout).toEqual({ parent: 0, text: 18, media: 0, quote: 0, replies: 0 })
    expect(sum(layout, false)).toBe(31 - 4)
  })

  // The reported case: a long tweet with a quote and a photo under it kept three rows. The
  // text scrolls and the photo cannot, so the two now split what the quote card leaves.
  test('a long tweet splits the rows a quote card leaves with the photo', () => {
    const layout = detailLayout(34, { photo: true, quote: true, quotePhoto: false, parent: false, textLines: 40 })
    expect(layout).toEqual({ parent: 0, text: 8, media: 7, quote: 5, replies: 0 })
    expect(sum(layout, true)).toBe(34 - 4)
  })

  test('a long tweet with a quote and no photo takes the rest of the pane', () => {
    const layout = detailLayout(34, { photo: false, quote: true, quotePhoto: false, parent: false, textLines: 40 })
    expect(layout.text).toBe(15)
    expect(layout.replies).toBe(0)
    expect(sum(layout, true)).toBe(34 - 4)
  })

  test('pays the parent card first and takes the rows from the photo', () => {
    const layout = detailLayout(50, { photo: true, quote: false, quotePhoto: false, parent: true, textLines: 4 })
    expect(layout).toEqual({ parent: 5, text: 4, media: 28, quote: 0, replies: 0 })
    expect(sum(layout, false)).toBe(50 - 4)
  })

  test('keeps the parent card whole on a short pane', () => {
    const layout = detailLayout(31, { photo: false, quote: false, quotePhoto: false, parent: true, textLines: 4 })
    expect(layout).toEqual({ parent: 5, text: 4, media: 0, quote: 0, replies: 9 })
    expect(sum(layout, false)).toBe(31 - 4)
  })

  test('drops the photo before the parent card when both cannot fit', () => {
    const layout = detailLayout(28, { photo: true, quote: true, quotePhoto: false, parent: true, textLines: 4 })
    expect(layout).toEqual({ parent: 5, text: 4, media: 0, quote: 5, replies: 0 })
    expect(sum(layout, true)).toBe(28 - 4)
  })

  test('the open list takes the pane, and the tweet gives up every row', () => {
    const layout = detailLayout(40, { photo: true, quote: true, quotePhoto: true, parent: true, textLines: 40, repliesOpen: true })
    expect(layout).toEqual({ parent: 0, text: 0, media: 0, quote: 0, replies: 40 - repliesViewChrome })
  })

  test('the open list holds four whole cards where the tweet held one', () => {
    const open = detailLayout(34, { photo: true, quote: true, quotePhoto: false, parent: false, textLines: 40, repliesOpen: true })
    const shut = detailLayout(34, { photo: true, quote: true, quotePhoto: false, parent: false, textLines: 40 })
    expect(open.replies).toBe(23)
    expect(shut.replies).toBe(0)
  })

  test('falls back to fixed rows before the pane is laid out', () => {
    expect(detailLayout(0, { photo: true, quote: true, quotePhoto: true, parent: true, textLines: 4 })).toEqual({ parent: 0, text: 3, media: 0, quote: 0, replies: 6 })
  })

  test('never returns a negative row count on a tiny pane', () => {
    for (const height of [1, 5, 9, 13, 17, 21, 25]) {
      const layout = detailLayout(height, { photo: true, quote: true, quotePhoto: true, parent: true, textLines: 40 })
      expect(Math.min(layout.parent, layout.text, layout.media, layout.quote, layout.replies)).toBeGreaterThanOrEqual(0)
    }
  })

  // A tweet at the text cap used to leave the photo three rows on every pane, so a picture
  // opened on a taller terminal was the same unreadable sliver as on a short one.
  test('a taller pane grows the photo under a long tweet', () => {
    const opts = { photo: true, quote: false, quotePhoto: false, parent: false, textLines: 40 }
    const heights = [24, 28, 32, 36, 44]
    const rows = heights.map((height) => detailLayout(height, opts).media)
    for (const [index, media] of rows.entries()) {
      expect(media).toBeGreaterThan(rows[index - 1] ?? 0)
    }
  })

  // The photo and the text split what is left, rather than the text taking its cap first and
  // handing the photo the crumbs. The photo keeps at least half the rows the text holds,
  // until it reaches its own cap and the text keeps the rest.
  test('a long tweet never leaves the photo a crumb of the text', () => {
    for (const height of [24, 28, 32, 36, 44, 50]) {
      const layout = detailLayout(height, { photo: true, quote: false, quotePhoto: false, parent: false, textLines: 40 })
      expect(layout.media).toBeGreaterThanOrEqual(Math.min(12, Math.floor(layout.text / 2)))
    }
  })

  // A half-screen terminal leaves the pane 22 rows. Six of them went to the blank row the
  // pane put between every section, which is what shrank the photo to a sliver.
  test('a half-screen pane still draws a photo the reader can see', () => {
    const layout = detailLayout(22, { photo: true, quote: false, quotePhoto: false, parent: false, textLines: 2 })
    expect(layout.media).toBe(6)
    expect(sum(layout, false)).toBe(22 - 4)
  })

  // Nothing draws under the photo while the reply list is shut, so a blank strip there is
  // a row the picture could have used.
  test('leaves no blank strip under a photo', () => {
    for (const height of [24, 30, 34, 40, 50]) {
      for (const textLines of [1, 4, 12, 40]) {
        const layout = detailLayout(height, { photo: true, quote: false, quotePhoto: false, parent: false, textLines })
        expect(layout.replies).toBe(0)
      }
    }
  })
})
