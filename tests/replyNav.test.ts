import { describe, expect, test } from 'bun:test'
import { createTestRenderer } from '@opentui/core/testing'
import { createMainScreen, repliesEmpty, repliesTitle, replyCapacity } from '../src/app/mainScreen.ts'
import {
  beginConversationLoad,
  clearDetailSelection,
  enterSelection,
  failConversationLoad,
  needsReplies,
  focusedTweet,
  initialAppState,
  leaveSelection,
  detailTargets,
  mergeConversationPage,
  mergeTimelinePage,
  parentIdOf,
  selectFirstReply,
  selectRelativeDetail,
  selectRelativeTweet,
  type AppState
} from '../src/state/store.ts'
import type { AppTweet } from '../src/twitter/types.ts'

const avatar = 'https://pbs.twimg.test/profile/one.jpg'

const tweet = (id: string, text = `tweet ${id}`, inReplyToStatusId?: string): AppTweet => ({
  id,
  text,
  author: { handle: `u${id}`, name: `U${id}`, avatarUrl: avatar },
  media: [],
  metrics: { replies: 1, reposts: 2, likes: 3 },
  inReplyToStatusId
})

const withReplies = (count: number): AppState => {
  const timeline = mergeTimelinePage(initialAppState(), 'following', [tweet('1'), tweet('2')], {})
  const replies = Array.from({ length: count }, (_, index) => tweet(`r${index}`, `reply body ${index}`, '1'))
  return mergeConversationPage(timeline, '1', replies)
}

// The reader drilled into the first reply, so its parent is the timeline tweet and the
// pane can draw the parent card without another request.
const insideReply = (count = 3): AppState => enterSelection(withReplies(count), 'r0')

const insideReplyWithReplies = (): AppState =>
  mergeConversationPage(insideReply(), 'r0', [tweet('rr0', 'nested 0', 'r0'), tweet('rr1', 'nested 1', 'r0')])

describe('reply selection', () => {
  test('the first move enters the list instead of stepping inside it', () => {
    const state = selectRelativeDetail(withReplies(3), 1)
    expect(state.selectedDetailId).toBe('r0')
    expect(state.status).toBe('reply 1/3 · Shift+→ opens it')
  })

  test('the next move steps down the list', () => {
    const state = selectRelativeDetail(selectRelativeDetail(withReplies(3), 1), 1)
    expect(state.selectedDetailId).toBe('r1')
  })

  test('a move up from nothing picks the last reply', () => {
    expect(selectRelativeDetail(withReplies(3), -1).selectedDetailId).toBe('r2')
  })

  test('the cursor stops at both ends of the list', () => {
    const first = selectRelativeDetail(withReplies(3), 1)
    expect(selectRelativeDetail(first, -1).selectedDetailId).toBe('r0')
    const last = selectRelativeDetail(withReplies(3), -1)
    expect(selectRelativeDetail(last, 1).selectedDetailId).toBe('r2')
  })

  test('a tweet with no replies does not move', () => {
    const state = withReplies(0)
    expect(selectRelativeDetail(state, 1)).toBe(state)
  })

  test('moving the timeline cursor drops the reply selection', () => {
    const state = selectRelativeDetail(withReplies(3), 1)
    expect(selectRelativeTweet(state, 1).selectedDetailId).toBeUndefined()
  })
})

describe('opening a reply', () => {
  test('the selected reply becomes the open tweet', () => {
    const state = enterSelection(selectRelativeDetail(withReplies(3), 1))
    expect(state.detailStack).toEqual(['r0'])
    expect(focusedTweet(state)?.id).toBe('r0')
    expect(state.selectedDetailId).toBeUndefined()
    expect(state.status).toBe('opened tweet @ur0 · Shift+← back')
  })

  test('a click passes the reply id and skips the selection', () => {
    const state = enterSelection(withReplies(3), 'r2')
    expect(state.detailStack).toEqual(['r2'])
    expect(focusedTweet(state)?.id).toBe('r2')
  })

  test('the open reply drops the list it came from', () => {
    const state = enterSelection(withReplies(3), 'r2')
    expect(detailTargets(state)).toEqual(['1'])
  })

  test('going back returns to the tweet and clears the selection', () => {
    const state = leaveSelection(enterSelection(selectRelativeDetail(withReplies(3), 1)))
    expect(state.detailStack).toEqual([])
    expect(state.selectedDetailId).toBeUndefined()
    expect(focusedTweet(state)?.id).toBe('1')
  })
})

describe('the right arrow', () => {
  test('focuses the first reply', () => {
    const state = selectFirstReply(withReplies(3))
    expect(state.selectedDetailId).toBe('r0')
    expect(state.status).toBe('reply 1/3 · Shift+→ opens it')
  })

  test('comes back to the first reply from anywhere in the list', () => {
    const third = selectRelativeDetail(selectRelativeDetail(selectRelativeDetail(withReplies(3), 1), 1), 1)
    expect(third.selectedDetailId).toBe('r2')
    expect(selectFirstReply(third).selectedDetailId).toBe('r0')
  })

  test('does nothing when the tweet has no replies', () => {
    const state = withReplies(0)
    expect(selectFirstReply(state)).toBe(state)
  })
})

describe('the parent card', () => {
  test('an open reply knows the tweet it answers', () => {
    expect(parentIdOf(insideReply())).toBe('1')
  })

  test('a timeline tweet has no parent card', () => {
    expect(parentIdOf(withReplies(3))).toBeUndefined()
  })

  test('a parent that never reached the tweet map is not a target', () => {
    const orphan = mergeTimelinePage(initialAppState(), 'following', [tweet('1', 'tweet 1', 'gone')], {})
    expect(parentIdOf(orphan)).toBeUndefined()
    expect(detailTargets(orphan)).toEqual([])
  })

  test('the parent sits above the replies in the cursor order', () => {
    expect(detailTargets(insideReplyWithReplies())).toEqual(['1', 'rr0', 'rr1'])
  })

  test('the first move up picks the parent instead of the last reply', () => {
    const state = selectRelativeDetail(insideReplyWithReplies(), -1)
    expect(state.selectedDetailId).toBe('1')
    expect(state.status).toBe('replying to @u1 · Shift+→ opens it')
  })

  test('the first move down still picks the first reply', () => {
    expect(selectRelativeDetail(insideReplyWithReplies(), 1).selectedDetailId).toBe('rr0')
  })

  test('moving up from the first reply reaches the parent', () => {
    const first = selectRelativeDetail(insideReplyWithReplies(), 1)
    expect(selectRelativeDetail(first, -1).selectedDetailId).toBe('1')
  })

  test('moving down from the parent reaches the first reply', () => {
    const parent = selectRelativeDetail(insideReplyWithReplies(), -1)
    expect(selectRelativeDetail(parent, 1).selectedDetailId).toBe('rr0')
  })

  test('opening the parent goes forward, not back', () => {
    const state = enterSelection(selectRelativeDetail(insideReply(), -1))
    expect(state.detailStack).toEqual(['r0', '1'])
    expect(focusedTweet(state)?.id).toBe('1')
  })
})

describe('reply list rows', () => {
  test('fits whole reply cards plus their gaps', () => {
    expect(replyCapacity(13)).toBe(2)
    expect(replyCapacity(20)).toBe(3)
    expect(replyCapacity(6)).toBe(1)
  })

  test('shows at least one card before the pane is laid out', () => {
    expect(replyCapacity(0)).toBe(1)
  })

  test('the header states how to reach the list and how to open a reply', () => {
    expect(repliesTitle(0, -1)).toBe('Replies')
    expect(repliesTitle(3, -1)).toBe('Replies · 3  ·  → picks one')
    expect(repliesTitle(3, 1)).toBe('Replies · 2/3  ·  Shift+→ opens it')
  })
})

const setup = async (state: AppState): Promise<{
  frame: string
  keys: string[]
  opened: string[]
  click: (key: string) => Promise<void>
}> => {
  const harness = await createTestRenderer({ width: 174, height: 52 })
  const opened: string[] = []
  const screen = createMainScreen(harness.renderer, { onOpenTweet: (id: string) => { opened.push(id) } })
  // The first pass has no measured pane, so the row budget only lands on the second.
  screen.render(state)
  await harness.flush()
  screen.render(state)
  await harness.flush()
  const click = async (key: string): Promise<void> => {
    const placement = screen.placements().find((item) => item.key === key)
    if (!placement) {
      throw new Error(`no placement for ${key}`)
    }
    await harness.mockMouse.click(placement.col, placement.row)
  }
  return { frame: harness.captureCharFrame(), keys: screen.placements().map((item) => item.key), opened, click }
}

describe('reply cards', () => {
  test('each reply gets a card with an avatar', async () => {
    const harness = await setup(withReplies(3))
    expect(harness.frame).toContain('@ur0')
    expect(harness.frame).toContain('reply body 0')
    expect(harness.keys).toContain('avatar:reply:r0')
    expect(harness.keys).toContain('avatar:reply:r1')
  })

  test('a click on a reply card opens that reply', async () => {
    const harness = await setup(withReplies(3))
    await harness.click('avatar:reply:r1')
    expect(harness.opened).toEqual(['r1'])
  })

  test('a reply card carries the same counts as a timeline card', async () => {
    const harness = await setup(withReplies(3))
    // The timeline card prints the same line, so the count proves the reply card has one.
    expect(harness.frame.split('\n').filter((row) => row.includes('1 replies   2 reposts   3 likes')).length).toBeGreaterThan(4)
  })

  test('a conversation that is still on its way says so', async () => {
    const harness = await setup(mergeTimelinePage(initialAppState(), 'following', [tweet('1')], {}))
    expect(harness.frame).toContain('Loading replies…')
  })

  test('a tweet that nobody answered says so', async () => {
    const harness = await setup(withReplies(0))
    expect(harness.frame).toContain('No replies yet.')
  })
})

describe('automatic reply loading', () => {
  test('a freshly selected tweet asks for its replies', () => {
    const state = mergeTimelinePage(initialAppState(), 'following', [tweet('1'), tweet('2')], {})
    expect(needsReplies(state)).toBe('1')
  })

  test('a tweet whose replies arrived is never asked again', () => {
    expect(needsReplies(withReplies(3))).toBeUndefined()
  })

  test('a tweet with no replies at all is never asked again', () => {
    expect(needsReplies(withReplies(0))).toBeUndefined()
  })

  test('a request in flight does not start a second one', () => {
    const state = mergeTimelinePage(initialAppState(), 'following', [tweet('1')], {})
    expect(needsReplies(beginConversationLoad(state, '1'))).toBeUndefined()
  })

  test('a failed request waits for Enter instead of retrying by itself', () => {
    const state = mergeTimelinePage(initialAppState(), 'following', [tweet('1')], {})
    const failed = failConversationLoad(beginConversationLoad(state, '1'), '1', 'rate limited')
    expect(failed.conversations['1']?.loading).toBe(false)
    expect(failed.status).toBe('reply load error: rate limited')
    expect(needsReplies(failed)).toBeUndefined()
  })

  test('an opened reply asks for its own replies', () => {
    expect(needsReplies(insideReply())).toBe('r0')
  })

  test('an empty feed asks for nothing', () => {
    expect(needsReplies(initialAppState())).toBeUndefined()
  })

  test('the list says why it is empty', () => {
    expect(repliesEmpty(undefined)).toBe('Loading replies…')
    expect(repliesEmpty({ tweetId: '1', replyIds: [], loading: true })).toBe('Loading replies…')
    expect(repliesEmpty({ tweetId: '1', replyIds: [], loading: false })).toBe('No replies yet.')
    expect(repliesEmpty({ tweetId: '1', replyIds: [], loading: false, error: 'rate limited' }))
      .toBe('Replies failed: rate limited · Enter retries.')
  })
})

describe('the left arrow', () => {
  test('hands the arrows back to the feed', () => {
    const state = clearDetailSelection(selectFirstReply(withReplies(3)))
    expect(state.selectedDetailId).toBeUndefined()
    expect(state.status).toBe('back to the feed')
  })

  test('does nothing when the feed already owns the arrows', () => {
    const state = withReplies(3)
    expect(clearDetailSelection(state)).toBe(state)
  })
})

describe('the thread above a tweet', () => {
  // X answers a tweet detail with the whole thread, so a reply's own page carries the
  // tweets above it. Real pages put those ancestors first.
  const pageForR0 = (): AppState =>
    mergeConversationPage(insideReply(), 'r0', [tweet('1'), tweet('rr0', 'nested 0', 'r0'), tweet('rr1', 'nested 1', 'r0')])

  test('keeps the parent out of the reply list', () => {
    expect(pageForR0().conversations.r0?.replyIds).toEqual(['rr0', 'rr1'])
  })

  test('the parent still reaches the tweet map for the parent card', () => {
    expect(parentIdOf(pageForR0())).toBe('1')
  })

  test('drops a whole chain of ancestors, not only the parent', () => {
    const root = mergeConversationPage(initialAppState(), 'x', [tweet('0'), tweet('1', 'tweet 1', '0'), tweet('r0', 'reply body 0', '1')])
    const deep = mergeConversationPage(enterSelection(root, 'r0'), 'r0', [tweet('0'), tweet('1', 'tweet 1', '0'), tweet('rr0', 'nested 0', 'r0')])
    expect(deep.conversations.r0?.replyIds).toEqual(['rr0'])
  })

  test('the cursor walks the replies instead of looping on the parent', () => {
    let state = selectFirstReply(pageForR0())
    expect(state.selectedDetailId).toBe('rr0')
    state = selectRelativeDetail(state, 1)
    expect(state.selectedDetailId).toBe('rr1')
    expect(state.status).toBe('reply 2/2 · Shift+→ opens it')
  })

  test('a later page cannot smuggle the parent back in', () => {
    const state = mergeConversationPage(pageForR0(), 'r0', [tweet('1'), tweet('rr2', 'nested 2', 'r0')])
    expect(state.conversations.r0?.replyIds).toEqual(['rr0', 'rr1', 'rr2'])
  })

  test('the parent keeps its top row and gives up any later copy', () => {
    const state = insideReply()
    const withParentInList = { ...state, conversations: { ...state.conversations, r0: { tweetId: 'r0', replyIds: ['rr0', '1'], loading: false } } }
    expect(detailTargets(withParentInList)).toEqual(['1', 'rr0'])
  })
})

describe('parent card rendering', () => {
  test('the open reply shows what it answers, with an avatar', async () => {
    const harness = await setup(insideReply())
    expect(harness.frame).toContain('↩ Replying to U1')
    expect(harness.frame).toContain('@u1')
    expect(harness.keys).toContain('avatar:parent:1')
  })

  test('a click on the parent card opens it', async () => {
    const harness = await setup(insideReply())
    await harness.click('avatar:parent:1')
    expect(harness.opened).toEqual(['1'])
  })

  test('a timeline tweet draws no parent card', async () => {
    const harness = await setup(withReplies(3))
    expect(harness.frame).not.toContain('↩ Replying to')
    expect(harness.keys).not.toContain('avatar:parent:1')
  })
})
