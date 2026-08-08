import { describe, expect, test } from 'bun:test'
import { cardCapacity, detailLayout, scrollWindow } from '../src/app/mainScreen.ts'

// The fixed rows are the author block (3), the media caption, the replies header and the
// metrics bar. Every extra box also costs its one-row gap. While the list is shut, `replies`
// is the blank strip that holds the metrics bar on the bottom row.
const sum = (layout: { parent: number; text: number; media: number; quote: number; replies: number }, boxes: number): number =>
  layout.parent + layout.text + layout.media + layout.quote + layout.replies + 6 + (boxes - 1)

// The open list keeps the author block, its header and the metrics bar, and nothing else.
const repliesViewChrome = 12

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
    expect(layout).toEqual({ parent: 0, text: 4, media: 8, quote: 5, replies: 0 })
    expect(sum(layout, 8)).toBe(34 - 4)
  })

  test('gives the photo every surplus row up to its cap', () => {
    const layout = detailLayout(34, { photo: true, quote: false, quotePhoto: false, parent: false, textLines: 4 })
    expect(layout).toEqual({ parent: 0, text: 4, media: 12, quote: 0, replies: 2 })
    expect(sum(layout, 7)).toBe(34 - 4)
  })

  test('prefers the tweet photo over the quoted photo when rows are scarce', () => {
    const layout = detailLayout(28, { photo: true, quote: true, quotePhoto: true, parent: false, textLines: 4 })
    expect(layout).toEqual({ parent: 0, text: 3, media: 3, quote: 5, replies: 0 })
    expect(sum(layout, 8)).toBe(28 - 4)
  })

  test('reserves extra rows for the quoted photo once the pane is tall enough', () => {
    const layout = detailLayout(40, { photo: true, quote: true, quotePhoto: true, parent: false, textLines: 4 })
    expect(layout).toEqual({ parent: 0, text: 4, media: 10, quote: 9, replies: 0 })
    expect(sum(layout, 8)).toBe(40 - 4)
  })

  test('caps the photo and leaves the rows a short tweet cannot use blank', () => {
    const layout = detailLayout(50, { photo: true, quote: false, quotePhoto: false, parent: false, textLines: 4 })
    expect(layout).toEqual({ parent: 0, text: 4, media: 12, quote: 0, replies: 18 })
    expect(sum(layout, 7)).toBe(50 - 4)
  })

  test('keeps the photo on a short pane with a quote card', () => {
    const layout = detailLayout(30, { photo: true, quote: true, quotePhoto: false, parent: false, textLines: 4 })
    expect(layout).toEqual({ parent: 0, text: 4, media: 4, quote: 5, replies: 0 })
    expect(sum(layout, 8)).toBe(30 - 4)
  })

  test('drops a photo that would render as a sliver and gives the rows to the text', () => {
    const layout = detailLayout(26, { photo: true, quote: true, quotePhoto: true, parent: false, textLines: 4 })
    expect(layout).toEqual({ parent: 0, text: 4, media: 0, quote: 5, replies: 0 })
    expect(sum(layout, 8)).toBe(26 - 4)
  })

  test('leaves the rows a short tweet cannot use blank', () => {
    const layout = detailLayout(31, { photo: false, quote: false, quotePhoto: false, parent: false, textLines: 4 })
    expect(layout).toEqual({ parent: 0, text: 4, media: 0, quote: 0, replies: 12 })
    expect(sum(layout, 6)).toBe(31 - 4)
  })

  test('gives a long tweet the rows the photo leaves over', () => {
    const layout = detailLayout(50, { photo: true, quote: false, quotePhoto: false, parent: false, textLines: 40 })
    expect(layout).toEqual({ parent: 0, text: 22, media: 12, quote: 0, replies: 0 })
    expect(sum(layout, 7)).toBe(50 - 4)
  })

  test('holds the text at its floor when the tweet is one line', () => {
    const layout = detailLayout(50, { photo: true, quote: false, quotePhoto: false, parent: false, textLines: 1 })
    expect(layout).toEqual({ parent: 0, text: 3, media: 12, quote: 0, replies: 19 })
    expect(sum(layout, 7)).toBe(50 - 4)
  })

  test('a long tweet with nothing under it takes the whole pane', () => {
    const layout = detailLayout(31, { photo: false, quote: false, quotePhoto: false, parent: false, textLines: 40 })
    expect(layout).toEqual({ parent: 0, text: 16, media: 0, quote: 0, replies: 0 })
    expect(sum(layout, 6)).toBe(31 - 4)
  })

  // The reported case: a long tweet with a quote and a photo under it kept three rows.
  test('a long tweet keeps the rows a quote card and a photo leave', () => {
    const layout = detailLayout(34, { photo: true, quote: true, quotePhoto: false, parent: false, textLines: 40 })
    expect(layout).toEqual({ parent: 0, text: 9, media: 3, quote: 5, replies: 0 })
    expect(sum(layout, 8)).toBe(34 - 4)
  })

  test('a long tweet with a quote and no photo takes the rest of the pane', () => {
    const layout = detailLayout(34, { photo: false, quote: true, quotePhoto: false, parent: false, textLines: 40 })
    expect(layout.text).toBe(13)
    expect(layout.replies).toBe(0)
    expect(sum(layout, 7)).toBe(34 - 4)
  })

  test('pays the parent card first and takes the rows from the photo', () => {
    const layout = detailLayout(50, { photo: true, quote: false, quotePhoto: false, parent: true, textLines: 4 })
    expect(layout).toEqual({ parent: 5, text: 4, media: 12, quote: 0, replies: 12 })
    expect(sum(layout, 8)).toBe(50 - 4)
  })

  test('keeps the parent card whole on a short pane', () => {
    const layout = detailLayout(31, { photo: false, quote: false, quotePhoto: false, parent: true, textLines: 4 })
    expect(layout).toEqual({ parent: 5, text: 4, media: 0, quote: 0, replies: 6 })
    expect(sum(layout, 7)).toBe(31 - 4)
  })

  test('drops the photo before the parent card when both cannot fit', () => {
    const layout = detailLayout(31, { photo: true, quote: true, quotePhoto: false, parent: true, textLines: 4 })
    expect(layout).toEqual({ parent: 5, text: 3, media: 0, quote: 5, replies: 0 })
    expect(sum(layout, 9)).toBe(31 - 4)
  })

  test('the open list takes the pane, and the tweet gives up every row', () => {
    const layout = detailLayout(40, { photo: true, quote: true, quotePhoto: true, parent: true, textLines: 40, repliesOpen: true })
    expect(layout).toEqual({ parent: 0, text: 0, media: 0, quote: 0, replies: 40 - repliesViewChrome })
  })

  test('the open list holds four whole cards where the tweet held one', () => {
    const open = detailLayout(34, { photo: true, quote: true, quotePhoto: false, parent: false, textLines: 40, repliesOpen: true })
    const shut = detailLayout(34, { photo: true, quote: true, quotePhoto: false, parent: false, textLines: 40 })
    expect(open.replies).toBe(22)
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
})
