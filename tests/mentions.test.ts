import { describe, expect, test } from 'bun:test'
import { createTestRenderer } from '@opentui/core/testing'
import { createMainScreen, mentionMenuCap, mentionMenuLines } from '../src/app/mainScreen.ts'
import { applyMention, mentionQuery } from '../src/state/mentions.ts'
import { chooseMention, closeMentions, initialAppState, insertIntoDraft, mergeMentionUsers, moveComposerCaret, moveMention, needsMentions, openComposer, closeComposer, deleteFromDraft } from '../src/state/store.ts'
import { TwitterClient } from '../src/twitter/client.ts'
import { parseTypeaheadUsers } from '../src/twitter/extract/typeahead.ts'
import { jsonResponse } from './helpers.ts'
import type { AppState, MentionsState } from '../src/state/store.ts'
import type { MentionUser } from '../src/twitter/types.ts'

const user = (handle: string, extra: Partial<MentionUser> = {}): MentionUser =>
  ({ id: `u${handle}`, handle, name: handle.toUpperCase(), ...extra })

const typing = (text: string): AppState => {
  const open = openComposer({ ...initialAppState(), composer: { open: false, mode: 'post', draft: '', caret: 0, sending: false } }, 'post')
  return insertIntoDraft(open, text)
}

const clientFor = (fetchMock: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): TwitterClient =>
  new TwitterClient({ authToken: 'auth', ct0: 'csrf', fetch: fetchMock, graphQLBase: 'https://x.com/i/api/graphql' })

describe('the mention under the caret', () => {
  test('is the word the @ starts, as far as the caret', () => {
    expect(mentionQuery('hello @cla', 10)).toBe('cla')
    expect(mentionQuery('@cla', 4)).toBe('cla')
    expect(mentionQuery('a line\n@cla', 11)).toBe('cla')
  })

  test('is nothing before the first letter, and nothing after a space', () => {
    expect(mentionQuery('hello @', 7)).toBeUndefined()
    expect(mentionQuery('hello @cla ', 11)).toBeUndefined()
    expect(mentionQuery('hello there', 11)).toBeUndefined()
  })

  test('an address is not a mention, because a handle starts a word', () => {
    expect(mentionQuery('write to alice@example', 22)).toBeUndefined()
    expect(mentionQuery('@@cla', 5)).toBeUndefined()
  })

  test('a caret inside a word says nothing, because tagging there would split it', () => {
    expect(mentionQuery('hello @claude', 9)).toBeUndefined()
    expect(mentionQuery('hello @claude and', 13)).toBe('claude')
  })

  test('nothing longer than a handle can be', () => {
    expect(mentionQuery(`@${'a'.repeat(15)}`, 16)).toBe('a'.repeat(15))
    expect(mentionQuery(`@${'a'.repeat(16)}`, 17)).toBeUndefined()
  })
})

describe('what the chosen handle does to the draft', () => {
  test('takes the place of what was typed, and leaves a space to write on', () => {
    expect(applyMention('hi @cla', 7, 'claudeai')).toEqual({ draft: 'hi @claudeai ', caret: 13 })
  })

  test('keeps what stands after the caret', () => {
    expect(applyMention('hi @cla, hello', 7, 'claudeai')).toEqual({ draft: 'hi @claudeai , hello', caret: 13 })
  })

  test('changes nothing when the caret is not in a mention', () => {
    expect(applyMention('hi there', 8, 'claudeai')).toEqual({ draft: 'hi there', caret: 8 })
  })
})

describe('the menu the drawer keeps', () => {
  test('opens on the @ the caret sits in, and asks for that query', () => {
    const state = typing('hi @cla')
    expect(state.mentions).toMatchObject({ query: 'cla', users: [], loading: true })
    expect(needsMentions(state)).toBe('cla')
  })

  test('closes when the caret leaves the mention', () => {
    const away = moveComposerCaret(typing('hi @cla'), 'start')
    expect(away.mentions).toBeUndefined()
    expect(needsMentions(away)).toBeUndefined()
  })

  test('keeps the accounts it holds while the next letter is read', () => {
    const answered = mergeMentionUsers(typing('hi @cla'), 'cla', [user('claudeai')])
    expect(answered.mentions?.users).toHaveLength(1)
    expect(needsMentions(answered)).toBeUndefined()
    const same = insertIntoDraft(answered, 'u')
    expect(same.mentions?.query).toBe('clau')
    expect(same.mentions?.loading).toBe(true)
  })

  test('a walk back to the same query asks again rather than lie', () => {
    const answered = mergeMentionUsers(typing('hi @clau'), 'clau', [user('claudeai')])
    const shorter = deleteFromDraft(answered, -1)
    expect(shorter.mentions).toMatchObject({ query: 'cla', users: [], loading: true })
  })

  test('an answer to a query the reader typed past is thrown away', () => {
    const state = typing('hi @clau')
    expect(mergeMentionUsers(state, 'cla', [user('claudeai')])).toBe(state)
  })

  test('the accounts fill the relationship map the follow badge reads', () => {
    const answered = mergeMentionUsers(typing('hi @cla'), 'cla', [user('claudeai', { following: true, followedBy: false })])
    expect(answered.relations['uclaudeai']).toEqual({ following: true, followedBy: false })
  })

  test('the walk wraps at both ends, and an empty menu does not move', () => {
    const answered = mergeMentionUsers(typing('hi @cla'), 'cla', [user('a'), user('b'), user('c')])
    expect(moveMention(answered, 1).mentions?.index).toBe(1)
    expect(moveMention(answered, -1).mentions?.index).toBe(2)
    expect(moveMention(moveMention(answered, 1), 2).mentions?.index).toBe(0)
    const empty = typing('hi @cla')
    expect(moveMention(empty, 1)).toBe(empty)
  })

  test('Esc takes the menu away and leaves the draft alone', () => {
    const answered = mergeMentionUsers(typing('hi @cla'), 'cla', [user('claudeai')])
    const shut = closeMentions(answered)
    expect(shut.mentions).toBeUndefined()
    expect(shut.composer.draft).toBe('hi @cla')
    expect(closeMentions(shut)).toBe(shut)
  })

  test('the chosen account lands in the draft and the menu closes with it', () => {
    const answered = mergeMentionUsers(typing('hi @cla'), 'cla', [user('claudeai'), user('claude_code')])
    const chosen = chooseMention(moveMention(answered, 1))
    expect(chosen.composer.draft).toBe('hi @claude_code ')
    expect(chosen.composer.caret).toBe(16)
    expect(chosen.mentions).toBeUndefined()
  })

  test('a closed drawer carries no menu into the next draft', () => {
    const answered = mergeMentionUsers(typing('hi @cla'), 'cla', [user('claudeai')])
    expect(closeComposer(answered).mentions).toBeUndefined()
    expect(openComposer(answered, 'post').mentions).toBeUndefined()
  })
})

describe('the menu on the screen', () => {
  const menu = (over: Partial<MentionsState>): MentionsState =>
    ({ query: 'cla', users: [], index: 0, loading: false, ...over })

  test('says which mention it answers, and what the keys do', () => {
    const lines = mentionMenuLines(menu({ users: [user('claudeai')] }), 60)
    expect(lines[0]).toContain('@cla')
    expect(lines[0]).toContain('Enter tags')
  })

  test('marks the chosen account, and names the ones you follow', () => {
    const users = [user('claudeai', { verified: true, following: true }), user('claude_code')]
    const lines = mentionMenuLines(menu({ users, index: 1 }), 60)
    expect(lines[1]).toBe('  @claudeai ✓  CLAUDEAI  ·  following')
    expect(lines[2]).toBe('▸ @claude_code  CLAUDE_CODE')
  })

  test('shows no more rows than it can, and keeps the chosen one on screen', () => {
    const users = Array.from({ length: 10 }, (_, index) => user(`u${index}`))
    const lines = mentionMenuLines(menu({ users, index: 9 }), 60)
    expect(lines).toHaveLength(mentionMenuCap + 1)
    expect(lines[mentionMenuCap]).toContain('▸ @u9')
  })

  test('cuts a row too wide for the drawer rather than wrap it', () => {
    const lines = mentionMenuLines(menu({ users: [user('claudeai', { name: 'A'.repeat(80) })] }), 30)
    expect(lines[1]?.length).toBe(30)
    expect(lines[1]?.endsWith('…')).toBe(true)
  })

  test('says it is looking, and says when nothing came back', () => {
    expect(mentionMenuLines(menu({ loading: true }), 60)[1]).toContain('looking')
    expect(mentionMenuLines(menu({}), 60)[1]).toContain('no accounts')
    expect(mentionMenuLines(undefined, 60)).toEqual([])
  })

  test('the drawer draws it under the draft', async () => {
    const harness = await createTestRenderer({ width: 120, height: 40 })
    const screen = createMainScreen(harness.renderer)
    const state = mergeMentionUsers(typing('hi @cla'), 'cla', [user('claudeai')])
    screen.render(state)
    await harness.flush()
    screen.render(state)
    await harness.flush()
    const frame = harness.captureCharFrame()
    expect(frame).toContain('hi @cla')
    expect(frame).toContain('@claudeai')
    expect(frame).toContain('Enter tags')
  })
})

describe('the accounts X offers', () => {
  const body = {
    users: [
      { id_str: '1', screen_name: 'claudeai', name: 'Claude', ext_is_blue_verified: true, social_context: { following: true, followed_by: false } },
      { id_str: '2', screen_name: 'claude_code', name: 'Claude Code', verified: false, social_context: 0 },
      { id_str: '3', name: 'no handle at all' }
    ]
  }

  test('reads the handle, the name, the tick and both relationship flags', () => {
    const users = parseTypeaheadUsers(body)
    expect(users).toEqual([
      { id: '1', handle: 'claudeai', name: 'Claude', verified: true, following: true, followedBy: false },
      { id: '2', handle: 'claude_code', name: 'Claude Code' }
    ])
  })

  test('an answer with nothing in it is an empty list, not a failure', () => {
    expect(parseTypeaheadUsers({})).toEqual([])
    expect(parseTypeaheadUsers('nonsense')).toEqual([])
  })

  test('asks the typeahead endpoint for accounts alone', async () => {
    const paths: string[] = []
    const client = clientFor(async (input) => {
      const url = new URL(input.toString())
      paths.push(`${url.pathname}?${url.searchParams.toString()}`)
      return jsonResponse(body)
    })
    const users = await client.searchUsers({ query: 'cla', count: 10 })
    expect(users).toHaveLength(2)
    const asked = new URL(`https://x.com${paths[0] ?? ''}`)
    expect(asked.pathname).toBe('/i/api/1.1/search/typeahead.json')
    expect(asked.searchParams.get('q')).toBe('cla')
    expect(asked.searchParams.get('result_type')).toBe('users')
    expect(asked.searchParams.get('count')).toBe('10')
  })

  // The reader is still typing, so a failed read must cost them nothing but the menu.
  test('a refusal gives back nothing rather than throw', async () => {
    const client = clientFor(async () => jsonResponse({ errors: [{ code: 88 }] }, { status: 429 }))
    expect(await client.searchUsers({ query: 'cla', count: 10 })).toEqual([])
  })
})
