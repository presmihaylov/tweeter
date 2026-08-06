import { describe, expect, test } from 'bun:test'
import { createTestRenderer } from '@opentui/core/testing'
import { createMainScreen } from '../src/app/mainScreen.ts'
import { initialAppState, mergeTimelinePage, type AppState } from '../src/state/store.ts'
import type { AppTweet } from '../src/twitter/types.ts'

const tweet: AppTweet = { id: '1', text: 'hello', author: { handle: 'alice', name: 'Alice' }, media: [], metrics: {} }

const drawerRows = async (draft: string, error?: string): Promise<string[]> => {
  const harness = await createTestRenderer({ width: 100, height: 40 })
  const screen = createMainScreen(harness.renderer)
  const base = mergeTimelinePage(initialAppState(), 'following', [tweet], {})
  const state: AppState = { ...base, composer: { open: true, replyToTweetId: '1', draft, sending: false, error } }
  // The first pass has no measured drawer, so the wrap only lands on the second.
  screen.render(state)
  await harness.flush()
  screen.render(state)
  await harness.flush()
  const rows = harness.captureCharFrame().split('\n').map((row) => row.trim())
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
