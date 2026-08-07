import { describe, expect, test } from 'bun:test'
import { createTestRenderer } from '@opentui/core/testing'
import { createMainScreen, helpCardHeight, helpCardWidth, helpColumn, helpContentHeight, helpContentWidth, helpGroups, helpHint, helpMinCardWidth, helpScrollMax, helpStacks } from '../src/app/mainScreen.ts'
import { helpScrollStep, isHelpKey } from '../src/app/keyEvents.ts'
import { closeHelp, initialAppState, mergeTimelinePage, scrollHelp, toggleHelp } from '../src/state/store.ts'
import type { AppKey } from '../src/app/keyEvents.ts'
import type { AppTweet } from '../src/twitter/types.ts'

const tweet: AppTweet = {
  id: '1',
  text: 'hello',
  author: { handle: 'alice', name: 'Alice' },
  media: [],
  metrics: { replies: 4, reposts: 12, likes: 300 }
}

const key = (over: Partial<AppKey>): AppKey => ({ name: '', ctrl: false, ...over })

describe('the ? key', () => {
  test('answers whichever shape the terminal sends', () => {
    expect(isHelpKey(key({ name: '?' }))).toBe(true)
    expect(isHelpKey(key({ name: '/', shift: true }))).toBe(true)
    expect(isHelpKey(key({ name: 'undefined', sequence: '?' }))).toBe(true)
  })

  test('leaves the plain slash and every modified press alone', () => {
    expect(isHelpKey(key({ name: '/' }))).toBe(false)
    expect(isHelpKey(key({ name: '?', ctrl: true }))).toBe(false)
    expect(isHelpKey(key({ name: '?', meta: true }))).toBe(false)
    expect(isHelpKey(key({ name: 'j', sequence: 'j' }))).toBe(false)
  })
})

describe('the help state', () => {
  test('one press opens the popup and the next closes it', () => {
    const shut = initialAppState()
    expect(shut.helpOpen).toBe(false)
    const open = toggleHelp(shut)
    expect(open.helpOpen).toBe(true)
    expect(toggleHelp(open).helpOpen).toBe(false)
  })

  test('a close on a closed popup changes nothing', () => {
    const shut = initialAppState()
    expect(closeHelp(shut)).toBe(shut)
    expect(closeHelp(toggleHelp(shut)).helpOpen).toBe(false)
  })

  test('the scroll stops at both ends and starts again from the top', () => {
    const open = toggleHelp(initialAppState())
    expect(open.helpScroll).toBe(0)
    expect(scrollHelp(open, -1, 12)).toBe(open)
    expect(scrollHelp(open, 5, 12).helpScroll).toBe(5)
    expect(scrollHelp(open, 40, 12).helpScroll).toBe(12)
    expect(scrollHelp(scrollHelp(open, 40, 12), 1, 12)).toMatchObject({ helpScroll: 12 })
    expect(closeHelp(scrollHelp(open, 5, 12)).helpScroll).toBe(0)
  })

  test('the same keys that walk a list walk the popup', () => {
    expect(helpScrollStep(key({ name: 'down' }))).toBe(1)
    expect(helpScrollStep(key({ name: 'j' }))).toBe(1)
    expect(helpScrollStep(key({ name: 'up' }))).toBe(-1)
    expect(helpScrollStep(key({ name: 'k' }))).toBe(-1)
    expect(helpScrollStep(key({ name: 'pagedown' }))).toBe(10)
    expect(helpScrollStep(key({ name: 'pageup' }))).toBe(-10)
    expect(helpScrollStep(key({ name: 'x' }))).toBe(0)
  })
})

describe('the key list', () => {
  test('starts every description of a group in the same column', () => {
    const lines = helpColumn({
      title: 'Test',
      entries: [{ keys: 'j / k', what: 'walk' }, { keys: 'q', what: 'quit' }]
    }).split('\n')
    expect(lines).toEqual(['j / k  walk', 'q      quit'])
  })

  test('names every key the app answers', () => {
    const listed = new Set(helpGroups.flatMap((group) => group.entries.map((entry) => entry.keys)))
    for (const keys of ['j / k', 'Tab', 's', 'R', 'l', 'b', 'r', 't', 'p', 'v', 'o', '?', 'q', 'Enter', 'Esc']) {
      expect(listed).toContain(keys)
    }
  })
})

describe('how the groups sit in the card', () => {
  test('a wide terminal gets a stack for each group, a narrow one gets fewer', () => {
    expect(helpStacks(174)).toHaveLength(3)
    expect(helpStacks(110)).toHaveLength(2)
    expect(helpStacks(80)).toHaveLength(1)
  })

  test('the card always fits the terminal it was measured against', () => {
    for (const width of [80, 100, 110, 140, 174, 220]) {
      expect(helpMinCardWidth(helpStacks(width))).toBeLessThanOrEqual(width)
      expect(helpCardWidth(width)).toBeLessThanOrEqual(width)
      expect(helpCardHeight(width, 52)).toBeLessThanOrEqual(52)
    }
  })

  // A card the size of its own text reads as a stray line of output, not as a window.
  test('the card takes most of the window and never less than its keys need', () => {
    for (const [width, height] of [[174, 52], [140, 44], [110, 46], [80, 46]] as const) {
      const stacks = helpStacks(width)
      expect(helpCardWidth(width)).toBeGreaterThanOrEqual(helpContentWidth(stacks))
      expect(helpCardWidth(width) * 2).toBeGreaterThan(width)
      expect(helpCardHeight(width, height) * 2).toBeGreaterThan(height)
    }
  })

  // A short window cannot hold the list, so the card grows to the window and scrolls.
  test('a short window gives the whole height to the card', () => {
    expect(helpCardHeight(69, 30)).toBe(30)
    expect(helpScrollMax(69, 30)).toBe(helpContentHeight(helpStacks(69)) + 6 - 30)
  })

  test('every group lands in exactly one stack', () => {
    for (const width of [80, 110, 174]) {
      const placed = helpStacks(width).flat()
      expect(placed).toHaveLength(helpGroups.length)
      expect(new Set(placed.map((group) => group.title)).size).toBe(helpGroups.length)
    }
  })
})

describe('the popup on the screen', () => {
  const frameOf = async (helpOpen: boolean, width = 174, height = 52, helpScroll = 0): Promise<string> => {
    const harness = await createTestRenderer({ width, height })
    const screen = createMainScreen(harness.renderer)
    const loaded = mergeTimelinePage(initialAppState(), 'following', [tweet], {})
    const state = { ...loaded, helpOpen, helpScroll }
    // The first pass has no measured pane, so the row budget only lands on the second.
    screen.render(state)
    await harness.flush()
    screen.render(state)
    await harness.flush()
    return harness.captureCharFrame()
  }

  // Where the card sits on the screen: the row of its top border, the row of its bottom
  // border, and the columns of its two corners on the top row.
  const cardBox = (frame: string): { top: number; bottom: number; left: number; right: number; rows: number } => {
    const lines = frame.split('\n').filter((line) => line !== '')
    const top = lines.findIndex((line) => line.includes(' Keys '))
    const bottom = lines.findIndex((line) => line.includes('Esc closes'))
    const border = lines[top] ?? ''
    return { top, bottom, left: border.indexOf('╭'), right: border.lastIndexOf('╮'), rows: lines.length }
  }

  test('the card sits in the middle of the window, across and down', async () => {
    for (const [width, height] of [[174, 52], [140, 44], [110, 46], [80, 46]] as const) {
      const box = cardBox(await frameOf(true, width, height))
      expect(box.top).toBeGreaterThanOrEqual(0)
      // An odd gap cannot split evenly, so the two sides may differ by one column or row.
      expect(Math.abs(box.left - (width - 1 - box.right))).toBeLessThanOrEqual(1)
      expect(Math.abs(box.top - (box.rows - 1 - box.bottom))).toBeLessThanOrEqual(1)
    }
  })

  test('the header says which key opens it, and says nothing more', async () => {
    const frame = await frameOf(false)
    expect(frame).toContain(helpHint)
    expect(frame).not.toContain('walk the feed')
  })

  test('an open popup shows all three groups and every key in them', async () => {
    const frame = await frameOf(true)
    for (const group of helpGroups) {
      expect(frame).toContain(group.title)
      for (const entry of group.entries) {
        expect(frame).toContain(entry.what)
      }
    }
    expect(frame).toContain('Esc closes')
  })

  // A description that wraps splits a key from what it does, which is the one thing the
  // popup is for. The narrow layout has to keep every line whole.
  test('keeps every description on one line on a narrow terminal', async () => {
    for (const width of [110, 80]) {
      const frame = await frameOf(true, width, 46)
      for (const group of helpGroups) {
        for (const entry of group.entries) {
          expect(frame).toContain(`${entry.keys}  `)
          expect(frame).toContain(entry.what)
        }
      }
    }
  })

  // A window this short cannot hold the list at once, so the last keys are only reachable
  // by scroll, and nothing must draw outside the border on the way.
  test('scrolls the keys a short window cuts off', async () => {
    const max = helpScrollMax(69, 30)
    expect(max).toBeGreaterThan(0)
    const top = await frameOf(true, 69, 30)
    expect(top).toContain('walk the feed')
    expect(top).not.toContain('take the character after')
    expect(top).toContain('↑ ↓ scrolls')

    const bottom = await frameOf(true, 69, 30, max)
    expect(bottom).toContain('take the character after')
    expect(bottom).not.toContain('walk the feed')
    // A clipped row that escaped the card would paint past its right border.
    for (const line of bottom.split('\n')) {
      const text = line.indexOf('take the')
      if (text >= 0) {
        expect(line.indexOf('│', text)).toBeGreaterThan(text)
      }
    }
  })

  test('a window with room for the whole list never offers the scroll', async () => {
    expect(helpScrollMax(174, 52)).toBe(0)
    expect(await frameOf(true)).not.toContain('↑ ↓ scrolls')
  })

  // A picture is painted over the grid, so an avatar behind the popup would show through it.
  test('holds back the pictures while it is up', async () => {
    const harness = await createTestRenderer({ width: 174, height: 52 })
    const screen = createMainScreen(harness.renderer)
    const loaded = mergeTimelinePage(initialAppState(), 'following', [
      { ...tweet, author: { ...tweet.author, avatarUrl: 'https://x.com/a.jpg' } }
    ], {})
    screen.render(loaded)
    await harness.flush()
    screen.render(loaded)
    await harness.flush()
    const behind = screen.placements().length
    screen.render({ ...loaded, helpOpen: true })
    await harness.flush()
    expect(screen.placements()).toEqual([])
    expect(behind).toBeGreaterThan(0)
  })
})
