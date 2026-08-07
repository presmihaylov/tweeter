import { describe, expect, test } from 'bun:test'
import { cardCapacity, detailLayout, scrollWindow } from '../src/app/mainScreen.ts'

// The fixed rows are the author block (3), the media caption, the replies header and the
// metrics bar. Every extra box also costs its one-row gap.
const sum = (layout: { parent: number; text: number; media: number; quote: number; replies: number }, boxes: number): number =>
  layout.parent + layout.text + layout.media + layout.quote + layout.replies + 6 + (boxes - 1)

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
    expect(layout).toEqual({ parent: 0, text: 3, media: 3, quote: 5, replies: 6 })
    expect(sum(layout, 8)).toBe(34 - 4)
  })

  test('gives the photo every surplus row above the replies floor', () => {
    const layout = detailLayout(34, { photo: true, quote: false, quotePhoto: false, parent: false, textLines: 4 })
    expect(layout).toEqual({ parent: 0, text: 4, media: 8, quote: 0, replies: 6 })
    expect(sum(layout, 7)).toBe(34 - 4)
  })

  test('prefers the tweet photo over the quoted photo when rows are scarce', () => {
    const layout = detailLayout(34, { photo: true, quote: true, quotePhoto: true, parent: false, textLines: 4 })
    expect(layout).toEqual({ parent: 0, text: 3, media: 3, quote: 5, replies: 6 })
    expect(sum(layout, 8)).toBe(34 - 4)
  })

  test('reserves extra rows for the quoted photo once the pane is tall enough', () => {
    const layout = detailLayout(40, { photo: true, quote: true, quotePhoto: true, parent: false, textLines: 4 })
    expect(layout).toEqual({ parent: 0, text: 4, media: 4, quote: 9, replies: 6 })
    expect(sum(layout, 8)).toBe(40 - 4)
  })

  test('caps the photo so a tall pane still shows replies', () => {
    const layout = detailLayout(50, { photo: true, quote: false, quotePhoto: false, parent: false, textLines: 4 })
    expect(layout).toEqual({ parent: 0, text: 4, media: 12, quote: 0, replies: 18 })
    expect(sum(layout, 7)).toBe(50 - 4)
  })

  test('borrows from the replies floor rather than lose the photo', () => {
    const layout = detailLayout(30, { photo: true, quote: true, quotePhoto: false, parent: false, textLines: 4 })
    expect(layout).toEqual({ parent: 0, text: 3, media: 3, quote: 5, replies: 2 })
    expect(sum(layout, 8)).toBe(30 - 4)
  })

  test('drops a photo that would render as a sliver and returns its rows', () => {
    const layout = detailLayout(28, { photo: true, quote: true, quotePhoto: false, parent: false, textLines: 4 })
    expect(layout.media).toBe(0)
    expect(layout.replies).toBe(3)
  })

  test('spends everything on the replies when there is no photo', () => {
    const layout = detailLayout(31, { photo: false, quote: false, quotePhoto: false, parent: false, textLines: 4 })
    expect(layout).toEqual({ parent: 0, text: 4, media: 0, quote: 0, replies: 12 })
    expect(sum(layout, 6)).toBe(31 - 4)
  })

  test('holds the text at its cap and lets the rest scroll', () => {
    const layout = detailLayout(50, { photo: true, quote: false, quotePhoto: false, parent: false, textLines: 40 })
    expect(layout).toEqual({ parent: 0, text: 12, media: 12, quote: 0, replies: 10 })
    expect(sum(layout, 7)).toBe(50 - 4)
  })

  test('holds the text at its floor when the tweet is one line', () => {
    const layout = detailLayout(50, { photo: true, quote: false, quotePhoto: false, parent: false, textLines: 1 })
    expect(layout).toEqual({ parent: 0, text: 3, media: 12, quote: 0, replies: 19 })
    expect(sum(layout, 7)).toBe(50 - 4)
  })

  test('holds a long tweet under its cap so the replies keep a whole card', () => {
    const layout = detailLayout(31, { photo: false, quote: false, quotePhoto: false, parent: false, textLines: 40 })
    expect(layout).toEqual({ parent: 0, text: 10, media: 0, quote: 0, replies: 6 })
    expect(sum(layout, 6)).toBe(31 - 4)
  })

  // The reported case: a long tweet with a quote under it left the reply card one row.
  test('a long tweet with a quote still leaves the replies a whole card', () => {
    const layout = detailLayout(34, { photo: false, quote: true, quotePhoto: false, parent: false, textLines: 40 })
    expect(layout.replies).toBe(6)
    expect(layout.text).toBe(7)
    expect(sum(layout, 7)).toBe(34 - 4)
  })

  test('a pane too short for both gives the replies what is over the text floor', () => {
    const layout = detailLayout(28, { photo: false, quote: true, quotePhoto: false, parent: false, textLines: 40 })
    expect(layout.text).toBe(3)
    expect(layout.replies).toBe(4)
  })

  test('pays the parent card first and takes the rows from the photo', () => {
    const layout = detailLayout(50, { photo: true, quote: false, quotePhoto: false, parent: true, textLines: 4 })
    expect(layout).toEqual({ parent: 5, text: 4, media: 12, quote: 0, replies: 12 })
    expect(sum(layout, 8)).toBe(50 - 4)
  })

  test('keeps the parent card and the replies floor on a short pane', () => {
    const layout = detailLayout(31, { photo: false, quote: false, quotePhoto: false, parent: true, textLines: 4 })
    expect(layout).toEqual({ parent: 5, text: 4, media: 0, quote: 0, replies: 6 })
    expect(sum(layout, 7)).toBe(31 - 4)
  })

  test('drops the photo before the parent card when both cannot fit', () => {
    const layout = detailLayout(34, { photo: true, quote: true, quotePhoto: false, parent: true, textLines: 4 })
    expect(layout).toEqual({ parent: 5, text: 3, media: 0, quote: 5, replies: 3 })
    expect(sum(layout, 9)).toBe(34 - 4)
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
