import { describe, expect, test } from 'bun:test'
import { createTestRenderer } from '@opentui/core/testing'
import { TwitterClient } from '../src/twitter/client.ts'
import { parseNotificationsPage } from '../src/twitter/extract/notifications.ts'
import { parseLegacyTweets } from '../src/twitter/extract/legacyTweet.ts'
import { createMainScreen, headerLine, noticeGlyph, noticeHint, notificationsTitle, railTabs, tabName } from '../src/app/mainScreen.ts'
import { nextTab, notificationLoadResult } from '../src/app/terminalApp.ts'
import {
  collapseNotice,
  expandNotice,
  focusedTweet,
  initialAppState,
  mergeNotificationsPage,
  needsOlderNotifications,
  needsOlderTweets,
  noticeExpanded,
  selectRelativeRow,
  selectedRow,
  type AppState
} from '../src/state/store.ts'
import { jsonResponse, legacyNotice, legacyPhoto, legacyTweet, legacyUser, mentionEntry, noticeEntry, notificationsBody } from './helpers.ts'

const alice = legacyUser('11', 'alice')
const bob = legacyUser('22', 'bob')

// The account's own post, the one a notice is about.
const mine = legacyTweet('101', '99', 'a post of mine')
const mention = legacyTweet('102', '11', 'hey @me look at this')

const bellList = { path: '/2/notifications/device_follow.json', title: 'Posts' }

const page = (): unknown => notificationsBody({
  users: [alice, bob, legacyUser('99', 'me')],
  tweets: [mine, mention],
  notices: [
    legacyNotice({ id: 'N1', icon: 'heart_icon', text: 'ALICE and BOB liked your post', fromUserIds: ['11', '22'], targetTweetId: '101' }),
    legacyNotice({ id: 'N2', icon: 'bell_icon', text: 'New post notifications for ALICE', fromUserIds: ['11'] })
  ],
  entries: [noticeEntry('N1', { fromUserIds: ['11', '22'], targetTweetId: '101' }), mentionEntry('102'), noticeEntry('N2', { fromUserIds: ['11'], list: bellList })]
})

// What the bell line stands for: the posts of the accounts the reader subscribed to.
const behindTheLine = (): unknown => notificationsBody({
  users: [alice],
  tweets: [legacyTweet('201', '11', 'the first post from somebody I subscribed to'), legacyTweet('202', '11', 'the second one')],
  entries: [mentionEntry('201'), mentionEntry('202')]
})

describe('reading the notifications payload', () => {
  test('maps the old REST tweet shape onto the same tweet the feeds use', () => {
    const withPhoto = legacyTweet('103', '11', 'a post with a picture', { extended_entities: { media: [legacyPhoto()] } })
    const tweets = parseLegacyTweets({ users: { 11: alice }, tweets: { 103: withPhoto } })
    expect(tweets).toHaveLength(1)
    expect(tweets[0]?.text).toBe('a post with a picture')
    expect(tweets[0]?.author.handle).toBe('alice')
    // full_text, not text; user_id_str, not a nested user result; counts on the tweet itself.
    expect(tweets[0]?.metrics.likes).toBe(3)
    expect(tweets[0]?.media[0]?.type).toBe('photo')
    // The 48px avatar is upsized the same way the GraphQL path upsizes it.
    expect(tweets[0]?.author.avatarUrl).toBe('https://pbs.twimg.test/profile/11_400x400.jpg')
  })

  test('hangs a quoted tweet on the tweet that quotes it', () => {
    const quoting = legacyTweet('104', '11', 'look at this', { quoted_status_id_str: '101' })
    const tweets = parseLegacyTweets({ users: { 11: alice, 99: legacyUser('99', 'me') }, tweets: { 101: mine, 104: quoting } })
    expect(tweets.find((tweet) => tweet.id === '104')?.quotedTweet?.id).toBe('101')
  })

  test('drops a tweet with no author in the users map', () => {
    expect(parseLegacyTweets({ users: {}, tweets: { 101: mine } })).toEqual([])
  })

  test('turns entries into a row for each notice and each mention', () => {
    const parsed = parseNotificationsPage(page())
    expect(parsed.rows.map((row) => row.key)).toEqual(['notification-N1', 'tweet-102', 'notification-N2'])
    expect(parsed.tweets.map((tweet) => tweet.id).sort()).toEqual(['101', '102'])
  })

  test('a notice carries its icon, its sentence and the tweet it is about', () => {
    const row = parseNotificationsPage(page()).rows[0]
    expect(row?.notice?.icon).toBe('like')
    expect(row?.notice?.text).toBe('ALICE and BOB liked your post')
    expect(row?.tweetId).toBe('101')
    // The first named user owns the face beside the line.
    expect(row?.notice?.avatarUrl).toBe('https://pbs.twimg.test/profile/11_normal.jpg')
    // X stamps in milliseconds; the screen reads a date.
    expect(row?.notice?.createdAt).toBe(new Date(1704067200000).toISOString())
  })

  test('a mention is a row with a tweet and no line above it', () => {
    const row = parseNotificationsPage(page()).rows[1]
    expect(row?.tweetId).toBe('102')
    expect(row?.notice).toBeUndefined()
  })

  test('a notice about nothing this app can open keeps its line and loses the tweet', () => {
    const row = parseNotificationsPage(page()).rows[2]
    expect(row?.notice?.icon).toBe('bell')
    expect(row?.tweetId).toBeUndefined()
  })

  test('a line that stands for a list carries the path and the heading', () => {
    const rows = parseNotificationsPage(page()).rows
    expect(rows[2]?.notice?.list).toEqual({ path: '/2/notifications/device_follow.json', title: 'Posts' })
    // A line about a post of yours points at that post, not at a list.
    expect(rows[0]?.notice?.list).toBeUndefined()
  })

  test('the two halves of the heading become one title', () => {
    const body = notificationsBody({
      users: [alice],
      notices: [legacyNotice({ id: 'N3', icon: 'heart_icon', text: 'ALICE liked 4 posts', fromUserIds: ['11'] })],
      entries: [noticeEntry('N3', { fromUserIds: ['11'], list: { path: '/2/notifications/view/abc.json', title: 'Liked', subtitle: 'by ALICE' } })]
    })
    expect(parseNotificationsPage(body).rows[0]?.notice?.list?.title).toBe('Liked by ALICE')
  })

  test('a path outside the notifications API never becomes a list', () => {
    const body = notificationsBody({
      users: [alice],
      notices: [legacyNotice({ id: 'N4', icon: 'bell_icon', text: 'New post alert', fromUserIds: ['11'] })],
      entries: [noticeEntry('N4', { fromUserIds: ['11'], list: { path: 'https://evil.test/steal.json', title: 'Posts' } })]
    })
    expect(parseNotificationsPage(body).rows[0]?.notice?.list).toBeUndefined()
  })

  test('takes both cursors off the operation entries', () => {
    const parsed = parseNotificationsPage(notificationsBody({ topCursor: 'T', bottomCursor: 'B' }))
    expect(parsed.topCursor).toBe('T')
    expect(parsed.bottomCursor).toBe('B')
    expect(parsed.rows).toEqual([])
  })

  test('answers an empty body with an empty page instead of throwing', () => {
    expect(parseNotificationsPage({})).toEqual({ rows: [], tweets: [] })
    expect(parseNotificationsPage(undefined)).toEqual({ rows: [], tweets: [] })
  })
})

describe('asking X for the notifications', () => {
  test('goes over the old REST path with the cookie headers', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = []
    const client = new TwitterClient({
      authToken: 'auth',
      ct0: 'csrf',
      fetch: async (url, init) => {
        calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> })
        return jsonResponse(page())
      }
    })
    const parsed = await client.loadNotificationsPage({ count: 40 })
    expect(parsed.rows).toHaveLength(3)
    const call = calls[0]
    expect(call?.url.startsWith('https://x.com/i/api/2/notifications/all.json?')).toBe(true)
    expect(call?.url).toContain('count=40')
    expect(call?.url).toContain('tweet_mode=extended')
    expect(call?.url).toContain('requestContext=launch')
    expect(call?.headers['x-csrf-token']).toBe('csrf')
    expect(call?.headers.cookie).toBe('auth_token=auth; ct0=csrf')
  })

  test('a page down carries the cursor and says it is a scroll', async () => {
    let seen = ''
    const client = new TwitterClient({
      authToken: 'auth',
      ct0: 'csrf',
      fetch: async (url) => {
        seen = String(url)
        return jsonResponse(page())
      }
    })
    await client.loadNotificationsPage({ count: 40, cursor: 'notif-bottom' })
    expect(seen).toContain('cursor=notif-bottom')
    expect(seen).toContain('requestContext=scroll')
  })

  test('a refusal becomes an error the screen can show', async () => {
    const client = new TwitterClient({
      authToken: 'auth',
      ct0: 'csrf',
      fetch: async () => jsonResponse({ errors: [{ code: 32 }] }, { status: 401 })
    })
    await expect(client.loadNotificationsPage({ count: 40 })).rejects.toThrow('401')
  })

  test('asks for the posts on the path X named on the line', async () => {
    let seen = ''
    const client = new TwitterClient({
      authToken: 'auth',
      ct0: 'csrf',
      fetch: async (url) => {
        seen = String(url)
        return jsonResponse(behindTheLine())
      }
    })
    const parsed = await client.loadNoticeList({ path: bellList.path, count: 40 })
    expect(parsed.rows.map((row) => row.key)).toEqual(['tweet-201', 'tweet-202'])
    expect(seen.startsWith('https://x.com/i/api/2/notifications/device_follow.json?')).toBe(true)
    expect(seen).toContain('count=40')
    expect(seen).toContain('tweet_mode=extended')
  })

  test('refuses a path that does not belong to the notifications API', async () => {
    const client = new TwitterClient({ authToken: 'auth', ct0: 'csrf', fetch: async () => jsonResponse({}) })
    await expect(client.loadNoticeList({ path: 'https://evil.test/steal.json', count: 40 })).rejects.toThrow('will not follow')
    await expect(client.loadNoticeList({ path: '/2/../1.1/dm/inbox.json', count: 40 })).rejects.toThrow('will not follow')
  })

  test('reads the unread badge x.com draws on its own tab', async () => {
    const client = new TwitterClient({
      authToken: 'auth',
      ct0: 'csrf',
      fetch: async () => jsonResponse({ ntab_unread_count: 4, dm_unread_count: 2, total_unread_count: 6 })
    })
    expect(await client.loadBadgeCounts()).toEqual({ notifications: 4, messages: 2 })
  })
})

const loaded = (): AppState => {
  const state = { ...initialAppState(), activeTab: 'notifications' as const }
  return mergeNotificationsPage(state, parseNotificationsPage(page()))
}

describe('the notifications tab in the state', () => {
  test('the first page picks the first row', () => {
    const state = loaded()
    expect(state.notifications.rows).toHaveLength(3)
    expect(state.selectedRowKey).toBe('notification-N1')
    expect(state.notifications.bottomCursor).toBe('notif-bottom')
    expect(state.notifications.loading).toBe(false)
  })

  test('the row under the cursor is what every tweet key acts on', () => {
    const state = loaded()
    expect(focusedTweet(state)?.id).toBe('101')
    const next = selectRelativeRow(state, 1)
    expect(selectedRow(next)?.key).toBe('tweet-102')
    expect(focusedTweet(next)?.text).toBe('hey @me look at this')
  })

  test('a row about no tweet leaves the keys with nothing to act on', () => {
    const state = selectRelativeRow(loaded(), 2)
    expect(selectedRow(state)?.notice?.icon).toBe('bell')
    expect(focusedTweet(state)).toBeUndefined()
  })

  test('the cursor stops at both ends', () => {
    const state = loaded()
    expect(selectRelativeRow(state, -1).selectedRowKey).toBe('notification-N1')
    expect(selectRelativeRow(state, 9).selectedRowKey).toBe('notification-N2')
    expect(selectRelativeRow(initialAppState(), 1).selectedRowKey).toBeUndefined()
  })

  test('a second page lands below and repeats nothing', () => {
    const first = loaded()
    const again = mergeNotificationsPage(first, parseNotificationsPage(page()))
    expect(again.notifications.rows).toHaveLength(3)
    // A page down that holds nothing new is the end, so nothing asks for it again.
    expect(again.notifications.bottomCursor).toBeUndefined()
    expect(needsOlderNotifications(again)).toBe(false)
  })

  test('what arrived since lands above, and the cursors each move one way', () => {
    const first = loaded()
    const extra = notificationsBody({
      users: [alice],
      tweets: [legacyTweet('105', '11', 'a newer mention')],
      entries: [mentionEntry('105')],
      topCursor: 'newer-top',
      bottomCursor: 'newer-bottom'
    })
    const refreshed = mergeNotificationsPage(first, parseNotificationsPage(extra), 'top')
    expect(refreshed.notifications.rows[0]?.key).toBe('tweet-105')
    expect(refreshed.notifications.topCursor).toBe('newer-top')
    expect(refreshed.notifications.bottomCursor).toBe('notif-bottom')
  })

  test('the end of the list pulls the next page down, and the feeds stay out of it', () => {
    const state = selectRelativeRow(loaded(), 2)
    expect(needsOlderNotifications(state)).toBe(true)
    // The notifications tab holds no timeline, so the feed loader must not fire here.
    expect(needsOlderTweets(state)).toBe(false)
    expect(needsOlderNotifications({ ...state, activeTab: 'following' })).toBe(false)
  })
})

describe('the posts behind a notice line', () => {
  const opened = (): AppState => expandNotice(loaded(), 'notification-N2', parseNotificationsPage(behindTheLine()))

  test('the posts land under the line and name it', () => {
    const state = opened()
    expect(state.notifications.rows.map((row) => row.key)).toEqual([
      'notification-N1',
      'tweet-102',
      'notification-N2',
      'notification-N2/tweet-201',
      'notification-N2/tweet-202'
    ])
    expect(state.notifications.rows[3]?.parentKey).toBe('notification-N2')
    expect(noticeExpanded(state, 'notification-N2')).toBe(true)
    expect(noticeExpanded(loaded(), 'notification-N2')).toBe(false)
  })

  test('the keys act on a post opened under a line', () => {
    const state = selectRelativeRow(opened(), 3)
    expect(focusedTweet(state)?.text).toBe('the first post from somebody I subscribed to')
  })

  test('a second open replaces the posts instead of repeating them', () => {
    const again = expandNotice(opened(), 'notification-N2', parseNotificationsPage(behindTheLine()))
    expect(again.notifications.rows).toHaveLength(5)
  })

  test('a line the list does not belong to leaves the rows alone', () => {
    const state = expandNotice(loaded(), 'notification-gone', parseNotificationsPage(behindTheLine()))
    expect(state.notifications.rows).toHaveLength(3)
  })

  test('closing takes the posts away and puts the cursor back on the line', () => {
    const state = selectRelativeRow(opened(), 4)
    expect(state.selectedRowKey).toBe('notification-N2/tweet-202')
    const closed = collapseNotice(state, 'notification-N2')
    expect(closed.notifications.rows).toHaveLength(3)
    expect(closed.selectedRowKey).toBe('notification-N2')
  })

  test('a cursor above the line stays where it is when the line closes', () => {
    const closed = collapseNotice(opened(), 'notification-N2')
    expect(closed.selectedRowKey).toBe('notification-N1')
  })

  test('the last row of the line says what Enter does', () => {
    const rows = parseNotificationsPage(page()).rows
    const bell = rows[2]?.notice
    expect(bell && noticeHint(bell, false)).toBe('Enter opens Posts')
    expect(bell && noticeHint(bell, true)).toBe('Enter closes Posts')
    const like = rows[0]?.notice
    expect(like && noticeHint(like, false)).toBe('')
  })

  test('draws the posts as cards that step in under the line', async () => {
    const harness = await createTestRenderer({ width: 174, height: 52 })
    const screen = createMainScreen(harness.renderer)
    const body = notificationsBody({
      users: [alice],
      notices: [legacyNotice({ id: 'N2', icon: 'bell_icon', text: 'New post alert', fromUserIds: ['11'] })],
      entries: [noticeEntry('N2', { fromUserIds: ['11'], list: bellList })]
    })
    const first = mergeNotificationsPage({ ...initialAppState(), activeTab: 'notifications' }, parseNotificationsPage(body))
    const state = expandNotice(first, 'notification-N2', parseNotificationsPage(behindTheLine()))
    screen.render(state)
    await harness.flush()
    screen.render(state)
    await harness.flush()
    const frame = harness.captureCharFrame()
    expect(frame).toContain('Enter closes Posts')
    expect(frame).toContain('the first post from somebody I')
    const line = (text: string): string => frame.split('\n').find((row) => row.includes(text)) ?? ''
    // A post under a line steps in two columns, the way x.com lists it under its heading.
    expect(line('ALICE  @alice').indexOf('ALICE') - line('◆ New post alert').indexOf('◆')).toBe(2)
    screen.destroy()
  })
})

describe('what the screen says about the tab', () => {
  test('Tab walks the three tabs and wraps', () => {
    const state = initialAppState()
    expect(nextTab(state)).toBe('forYou')
    expect(nextTab({ ...state, activeTab: 'forYou' })).toBe('notifications')
    expect(nextTab({ ...state, activeTab: 'notifications' })).toBe('following')
  })

  test('each tab has a name, and the rail marks the open one', () => {
    expect(tabName(initialAppState(), 'notifications')).toBe('Notifications')
    expect(railTabs(loaded())).toContain('● Notifications')
    expect(railTabs(initialAppState())).toContain('○ Notifications')
  })

  test('the title counts rows, not tweets', () => {
    expect(notificationsTitle(loaded().notifications)).toBe('Notifications · 3 rows')
    expect(notificationsTitle({ rows: [], loading: false, unread: 2 })).toBe('Notifications · 0 rows · 2 unread')
  })

  test('the unread count rides the header, so every tab shows it', () => {
    const state = loaded()
    expect(headerLine('@me', state)).toBe('@me · Notifications')
    expect(headerLine('@me', { ...state, notifications: { ...state.notifications, unread: 3 } })).toBe('@me · Notifications · 3 unread')
  })

  test('one glyph carries what the line is about', () => {
    expect(noticeGlyph('like')).toBe('♥')
    expect(noticeGlyph('repost')).toBe('↻')
    expect(noticeGlyph('other')).toBe('•')
  })

  test('says a notice line, the post under it and the mention as a card', async () => {
    const harness = await createTestRenderer({ width: 174, height: 52 })
    const screen = createMainScreen(harness.renderer)
    // A card is narrow, and a long sentence wraps in it, so this one is short enough to read
    // back whole.
    const body = notificationsBody({
      users: [alice, legacyUser('99', 'me')],
      tweets: [mine, mention],
      notices: [
        legacyNotice({ id: 'N1', icon: 'heart_icon', text: 'ALICE liked your post', fromUserIds: ['11'], targetTweetId: '101' }),
        legacyNotice({ id: 'N2', icon: 'bell_icon', text: 'New post alert', fromUserIds: ['11'] })
      ],
      entries: [noticeEntry('N1', { fromUserIds: ['11'], targetTweetId: '101' }), mentionEntry('102'), noticeEntry('N2', { fromUserIds: ['11'] })]
    })
    const state = mergeNotificationsPage({ ...initialAppState(), activeTab: 'notifications' }, parseNotificationsPage(body))
    // The first pass has no measured pane, so the row budget only lands on the second.
    screen.render(state)
    await harness.flush()
    screen.render(state)
    await harness.flush()
    const frame = harness.captureCharFrame()
    expect(frame).toContain('♥ ALICE liked your post')
    expect(frame).toContain('a post of mine')
    expect(frame).toContain('@alice')
    expect(frame).toContain('◆ New post alert')
    expect(frame).toContain('Notifications · 3 rows')
    screen.destroy()
  })

  test('an empty tab says so rather than showing a feed message', async () => {
    const harness = await createTestRenderer({ width: 174, height: 52 })
    const screen = createMainScreen(harness.renderer)
    const state: AppState = { ...initialAppState(), activeTab: 'notifications' }
    screen.render(state)
    await harness.flush()
    screen.render(state)
    await harness.flush()
    expect(harness.captureCharFrame()).toContain('No notifications yet.')
    screen.destroy()
  })

  test('names what a load did', () => {
    expect(notificationLoadResult('initial', 3)).toBe('loaded 3 notifications')
    expect(notificationLoadResult('newer', 0)).toBe('no new notifications')
    expect(notificationLoadResult('older', 2)).toBe('2 older notifications')
  })
})
