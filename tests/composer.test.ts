import { describe, expect, test } from 'bun:test'
import { createTestRenderer } from '@opentui/core/testing'
import { composerBody, createMainScreen } from '../src/app/mainScreen.ts'
import { caretMoveFor, isTextInput } from '../src/app/keyEvents.ts'
import {
  deleteFromDraft,
  initialAppState,
  insertIntoDraft,
  mergeTimelinePage,
  moveComposerCaret,
  openComposer,
  type AppState,
  type CaretMove
} from '../src/state/store.ts'
import type { AppTweet } from '../src/twitter/types.ts'

const tweet: AppTweet = { id: '1', text: 'hello', author: { handle: 'alice', name: 'Alice' }, media: [], metrics: {} }

const feed = (): AppState => mergeTimelinePage(initialAppState(), 'following', [tweet], {})

const withDraft = (draft: string, caret = draft.length): AppState =>
  ({ ...feed(), composer: { open: true, mode: 'reply', targetTweetId: '1', draft, caret, sending: false } })

const drawn = async (state: AppState): Promise<{ rows: string[]; cursor: { x: number; y: number; visible: boolean } }> => {
  const harness = await createTestRenderer({ width: 100, height: 40 })
  const screen = createMainScreen(harness.renderer)
  // The first pass has no measured drawer, so the wrap only lands on the second.
  screen.render(state)
  await harness.flush()
  screen.render(state)
  await harness.flush()
  const cursor = harness.renderer.getCursorState()
  return { rows: harness.captureCharFrame().split('\n'), cursor: { x: cursor.x, y: cursor.y, visible: cursor.visible } }
}

const drawerRows = async (draft: string, error?: string): Promise<string[]> => {
  const state: AppState = { ...withDraft(draft), composer: { ...withDraft(draft).composer, error } }
  const rows = (await drawn(state)).rows.map((row) => row.trim())
  const heading = rows.findIndex((row) => row.includes('Replying to @alice'))
  return rows.slice(heading + 1, rows.findIndex((row, index) => index > heading && row.startsWith('╰')))
}

describe('the composer on screen', () => {
  test('wraps a draft that is wider than the drawer', async () => {
    const draft = 'This is a long reply that should wrap onto a second line instead of dying at the edge of the drawer.'
    const rows = (await drawerRows(draft)).filter((row) => row !== '│' && row !== '')
    expect(rows.length).toBeGreaterThan(1)
    // Nothing the reader typed may fall off the end.
    expect(rows.join(' ').replaceAll('│', '').replaceAll(/\s+/g, ' ').trim()).toContain('edge of the drawer.')
  })

  test('a short draft keeps the drawer small', async () => {
    const rows = await drawerRows('hi')
    expect(rows.filter((row) => row.includes('hi'))).toHaveLength(1)
    expect(rows.length).toBeLessThan(4)
  })

  test('the reason shows in full under the draft', async () => {
    const rows = await drawerRows('hi', 'This request looks like it might be automated. (code 226)\nThe draft is kept. Log: /tmp/tweeter.log')
    const text = rows.join(' ').replaceAll('│', '')
    expect(text).toContain('Error: This request looks like it might be automated. (code 226)')
    expect(text).toContain('/tmp/tweeter.log')
    expect(text).toContain('hi')
  })
})

// The terminal draws the cursor itself, so the frame never holds it. Its cell is the only
// proof that it sits where the next character lands.
describe('the caret on screen', () => {
  const cellOf = (rows: string[], word: string, caret: number): { x: number; y: number } => {
    const row = rows.findIndex((line) => line.includes(word))
    return { x: (rows[row]?.indexOf(word) ?? 0) + caret + 1, y: row + 1 }
  }

  test('sits on the character the caret is in front of', async () => {
    const picture = await drawn(withDraft('hello world', 6))
    expect(picture.cursor.visible).toBe(true)
    expect(picture.cursor).toEqual({ ...cellOf(picture.rows, 'hello world', 6), visible: true })
  })

  test('follows the draft onto the second row', async () => {
    const draft = 'wrap me '.repeat(20)
    const picture = await drawn(withDraft(draft, draft.length))
    const first = picture.rows.findIndex((row) => row.includes('wrap me'))
    expect(picture.cursor.y).toBeGreaterThan(first + 1)
  })

  test('a closed composer shows no cursor at all', async () => {
    expect((await drawn(feed())).cursor.visible).toBe(false)
  })
})

describe('the caret in the drawer', () => {
  test('names the row and the column the caret landed on', () => {
    const drawer = composerBody('one two three', undefined, 9, 9)
    expect(drawer.text.split('\n')).toEqual(['one two', 'three'])
    expect([drawer.caretRow, drawer.caretCol]).toEqual([1, 1])
  })

  test('a caret on the space a row broke on stays on that row', () => {
    const drawer = composerBody('one two three', undefined, 9, 7)
    expect([drawer.caretRow, drawer.caretCol]).toEqual([0, 7])
  })

  test('keeps the row the caret is on when the head of the draft goes', () => {
    const draft = Array.from({ length: 12 }, (_, index) => `line${index}`).join('\n')
    // The caret sits on line1, which the cap would otherwise drop.
    const drawer = composerBody(draft, undefined, 40, 8)
    expect(drawer.text.split('\n')[0]).toBe('line1')
    expect(drawer.caretRow).toBe(0)
  })
})

describe('editing the draft', () => {
  const draftOf = (state: AppState): [string, number] => [state.composer.draft, state.composer.caret]

  test('a character lands at the caret, not at the end', () => {
    expect(draftOf(insertIntoDraft(withDraft('helo', 3), 'l'))).toEqual(['hello', 4])
  })

  test('a paste lands whole', () => {
    expect(draftOf(insertIntoDraft(withDraft('', 0), 'pasted'))).toEqual(['pasted', 6])
  })

  test('a new line breaks the draft in two and moves the caret past the break', () => {
    const state = insertIntoDraft(withDraft('ab', 2), '\n')
    expect(draftOf(state)).toEqual(['ab\n', 3])
    const drawer = composerBody(insertIntoDraft(state, 'cd').composer.draft, undefined, 20)
    expect(drawer.text.split('\n')).toEqual(['ab', 'cd'])
  })

  test('backspace takes the character behind the caret and delete the one in front', () => {
    expect(draftOf(deleteFromDraft(withDraft('hello', 3), -1))).toEqual(['helo', 2])
    expect(draftOf(deleteFromDraft(withDraft('hello', 3), 1))).toEqual(['helo', 3])
  })

  test('neither key runs off the end of the draft', () => {
    expect(deleteFromDraft(withDraft('hi', 0), -1).composer.draft).toBe('hi')
    expect(deleteFromDraft(withDraft('hi', 2), 1).composer.draft).toBe('hi')
  })

  const moved = (draft: string, caret: number, move: CaretMove): number =>
    moveComposerCaret(withDraft(draft, caret), move).composer.caret

  test('the arrows walk one character and stop at both ends', () => {
    expect(moved('hi', 1, 'left')).toBe(0)
    expect(moved('hi', 0, 'left')).toBe(0)
    expect(moved('hi', 1, 'right')).toBe(2)
    expect(moved('hi', 2, 'right')).toBe(2)
  })

  test('Home and End reach the two ends', () => {
    expect(moved('hello', 3, 'start')).toBe(0)
    expect(moved('hello', 3, 'end')).toBe(5)
  })

  test('a word jump lands where the word starts', () => {
    expect(moved('one two three', 13, 'wordLeft')).toBe(8)
    expect(moved('one two three', 8, 'wordLeft')).toBe(4)
    expect(moved('one two three', 0, 'wordRight')).toBe(3)
    expect(moved('one two three', 3, 'wordRight')).toBe(7)
  })

  test('the drawer opens empty with the caret at the start', () => {
    const state = openComposer(feed(), 'reply')
    expect(state.composer).toEqual({ open: true, mode: 'reply', targetTweetId: '1', draft: '', caret: 0, sending: false })
  })
})

describe('the keys a text field answers', () => {
  test('the arrows move the caret, and Alt or Ctrl makes them jump a word', () => {
    expect(caretMoveFor({ name: 'left', ctrl: false })).toBe('left')
    expect(caretMoveFor({ name: 'right', ctrl: false })).toBe('right')
    expect(caretMoveFor({ name: 'left', ctrl: false, meta: true })).toBe('wordLeft')
    expect(caretMoveFor({ name: 'right', ctrl: true })).toBe('wordRight')
  })

  test('Home, End and their shell aliases reach the ends', () => {
    expect(caretMoveFor({ name: 'home', ctrl: false })).toBe('start')
    expect(caretMoveFor({ name: 'end', ctrl: false })).toBe('end')
    expect(caretMoveFor({ name: 'a', ctrl: true })).toBe('start')
    expect(caretMoveFor({ name: 'e', ctrl: true })).toBe('end')
  })

  test('every other key moves nothing', () => {
    expect(caretMoveFor({ name: 'a', ctrl: false })).toBeUndefined()
    expect(caretMoveFor({ name: 'up', ctrl: false })).toBeUndefined()
  })

  test('text is what carries no escape and no control key', () => {
    expect(isTextInput({ name: 'a', ctrl: false, sequence: 'a' })).toBe(true)
    expect(isTextInput({ name: 'paste', ctrl: false, sequence: 'two words' })).toBe(true)
    expect(isTextInput({ name: 'left', ctrl: false, sequence: '\u001b[D' })).toBe(false)
    expect(isTextInput({ name: 'backspace', ctrl: false, sequence: '\u007f' })).toBe(false)
    expect(isTextInput({ name: 'l', ctrl: true, sequence: '\u000c' })).toBe(false)
    expect(isTextInput({ name: 'up', ctrl: false })).toBe(false)
  })
})
