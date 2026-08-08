import { describe, expect, test } from 'bun:test'
import { createTestRenderer } from '@opentui/core/testing'
import { isStatsKey } from '../src/app/keyEvents.ts'
import { buildStatsRows, dayKey, dayLabel, nextStatsWindow, recentDays, statsTotals } from '../src/stats/aggregate.ts'
import { analyticsRange, analyticsVariables, parseAnalytics, utcDayKey } from '../src/twitter/analytics.ts'
import { formatChange, formatCount, statsBodyLines, statsHeadline, statsTableLines } from '../src/app/statsView.ts'
import { createMainScreen, statsScrollMaxOf } from '../src/app/mainScreen.ts'
import { getUserTimelineInstructions, parseTimelineProfile, parseUserTweets } from '../src/twitter/extract/tweet.ts'
import { beginStatsLoad, closeStats, failStatsLoad, initialAppState, mergeStats, mergeTimelinePage, scrollStats, toggleHelp, toggleStats, turnStatsWindow } from '../src/state/store.ts'
import type { AnalyticsDay, AnalyticsHistory } from '../src/twitter/analytics.ts'
import type { AppKey } from '../src/app/keyEvents.ts'
import type { AppProfile, AppTweet } from '../src/twitter/types.ts'

const key = (over: Partial<AppKey>): AppKey => ({ name: '', ctrl: false, ...over })

const me = 'u1'
const now = new Date(2026, 7, 8, 10, 0, 0)

const mine = (id: string, over: Partial<AppTweet> = {}): AppTweet => ({
  id,
  text: `post ${id}`,
  author: { id: me, handle: 'me', name: 'Me' },
  createdAt: new Date(2026, 7, 8, 12, 30, 0).toISOString(),
  media: [],
  metrics: { views: 100 },
  ...over
})

const profile: AppProfile = { id: me, handle: 'me', name: 'Me', followers: 1200, following: 300, posts: 4500 }

const day = (over: Partial<AnalyticsDay> = {}): AnalyticsDay =>
  ({ posts: 0, replies: 0, impressions: 0, follows: 0, unfollows: 0, ...over })

// What X answered for, keyed by day, as the client hands it to the rows.
const history = (days: Record<string, Partial<AnalyticsDay>>): AnalyticsHistory =>
  Object.fromEntries(Object.entries(days).map(([key, value]) => [key, day(value)]))

describe('the Shift+S key', () => {
  test('answers whichever shape the terminal sends', () => {
    expect(isStatsKey(key({ name: 'S' }))).toBe(true)
    expect(isStatsKey(key({ name: 's', shift: true }))).toBe(true)
  })

  test('leaves the plain s and every modified press alone', () => {
    expect(isStatsKey(key({ name: 's' }))).toBe(false)
    expect(isStatsKey(key({ name: 'S', ctrl: true }))).toBe(false)
    expect(isStatsKey(key({ name: 'S', meta: true }))).toBe(false)
  })
})

describe('the stats state', () => {
  test('one press opens the page and the next closes it', () => {
    const shut = initialAppState()
    expect(shut.stats.open).toBe(false)
    const open = toggleStats(shut)
    expect(open.stats.open).toBe(true)
    expect(toggleStats(open).stats.open).toBe(false)
  })

  test('the page and the key popup never share the screen', () => {
    expect(toggleStats(toggleHelp(initialAppState())).helpOpen).toBe(false)
  })

  test('a close on a closed page changes nothing', () => {
    const shut = initialAppState()
    expect(closeStats(shut)).toBe(shut)
  })

  test('the window turns through the three the page offers', () => {
    expect(nextStatsWindow(7)).toBe(14)
    expect(nextStatsWindow(14)).toBe(30)
    expect(nextStatsWindow(30)).toBe(7)
    const open = toggleStats(initialAppState())
    expect(turnStatsWindow(open).stats.window).toBe(14)
  })

  test('a turned window starts the page at the top again', () => {
    const scrolled = scrollStats(toggleStats(initialAppState()), 4, 10)
    expect(scrolled.stats.scroll).toBe(4)
    expect(turnStatsWindow(scrolled).stats.scroll).toBe(0)
  })

  test('the scroll stops at both ends', () => {
    const open = toggleStats(initialAppState())
    expect(scrollStats(open, -1, 8)).toBe(open)
    expect(scrollStats(open, 40, 8).stats.scroll).toBe(8)
  })

  test('a load that fails leaves the page open with a reason', () => {
    const failed = failStatsLoad(beginStatsLoad(toggleStats(initialAppState())), 'no')
    expect(failed.stats.loading).toBe(false)
    expect(failed.stats.error).toBe('no')
  })

  test('counted rows replace the last ones and name the window they cover', () => {
    const rows = buildStatsRows({ window: 7, now, history: history({ '2026-08-08': { posts: 1 } }) })
    const merged = mergeStats(beginStatsLoad(toggleStats(initialAppState())), { rows, totals: statsTotals(rows), profile, loadedWindow: 7 })
    expect(merged.stats.loading).toBe(false)
    expect(merged.stats.rows).toHaveLength(7)
    expect(merged.stats.loadedWindow).toBe(7)
    expect(merged.stats.profile?.followers).toBe(1200)
  })
})

describe('the days', () => {
  test('a day is the day the machine is in', () => {
    expect(dayKey(new Date(2026, 7, 8, 1, 0, 0))).toBe('2026-08-08')
  })

  test('today says today, and every other day names itself', () => {
    expect(dayLabel('2026-08-08', now)).toBe('Today')
    expect(dayLabel('2026-08-07', now)).toBe('Fri 07 Aug')
  })

  test('the window runs back from today, newest first', () => {
    const days = recentDays(now, 7)
    expect(days).toHaveLength(7)
    expect(days[0]).toBe('2026-08-08')
    expect(days.at(-1)).toBe('2026-08-02')
  })
})

describe('what the rows say', () => {
  test('each day carries the four numbers X counted for it', () => {
    const rows = buildStatsRows({
      window: 7,
      now,
      history: history({
        '2026-08-08': { posts: 3, replies: 20, impressions: 2642, follows: 4, unfollows: 1 },
        '2026-08-07': { posts: 7, replies: 70, impressions: 11624, follows: 6, unfollows: 1 }
      })
    })
    expect(rows[0]).toMatchObject({ day: '2026-08-08', posts: 3, replies: 20, impressions: 2642, followerChange: 3, covered: true })
    expect(rows[1]).toMatchObject({ day: '2026-08-07', posts: 7, replies: 70, impressions: 11624, followerChange: 5 })
  })

  test('a day X answered nothing for reads as unknown, not as a quiet day', () => {
    const rows = buildStatsRows({ window: 7, now, history: history({ '2026-08-08': { posts: 1 } }) })
    expect(rows[0]?.covered).toBe(true)
    expect(rows[1]?.covered).toBe(false)
    expect(rows[1]?.followerChange).toBeUndefined()
  })

  test('the total adds the days X answered for and leaves the rest out', () => {
    const rows = buildStatsRows({
      window: 7,
      now,
      history: history({
        '2026-08-08': { posts: 2, replies: 5, impressions: 100, follows: 3, unfollows: 1 },
        '2026-08-06': { posts: 1, replies: 2, impressions: 50, follows: 0, unfollows: 4 }
      })
    })
    expect(statsTotals(rows)).toEqual({ posts: 3, replies: 7, impressions: 150, followerChange: -2 })
  })

  test('an empty answer leaves the total without numbers to add', () => {
    expect(statsTotals(buildStatsRows({ window: 7, now, history: {} })).followerChange).toBeUndefined()
  })
})

describe('the analytics X serves', () => {
  const analyticsBody = (series: unknown[], backfill: unknown[] = []): unknown => ({
    data: { viewer_v2: { user_results: { result: { current_time_series: series, hourly_backfill: backfill } } } }
  })

  const row = (kind: string, count: number, at: string): unknown => ({
    engagement_type: kind,
    count,
    timestamp: Date.parse(at),
    is_engaging_user_verified: false
  })

  test('the window ends after today and runs back the days it asks for', () => {
    const variables = analyticsVariables(new Date('2026-08-08T10:00:00Z'), 7)
    expect(variables.current_to_iso).toBe('2026-08-09T00:00:00.000Z')
    expect(variables.current_from_iso).toBe('2026-08-02T00:00:00.000Z')
    expect(variables.prev_from_iso).toBe('2026-07-26T00:00:00.000Z')
    expect(variables.prev_to_iso).toBe('2026-08-02T00:00:00.000Z')
  })

  // The daily series lags about two days, so the second series has to reach yesterday.
  test('the finer series covers yesterday and today', () => {
    const variables = analyticsVariables(new Date('2026-08-08T10:00:00Z'), 7)
    expect(new Date(Number(variables.backfill_from)).toISOString()).toBe('2026-08-07T00:00:00.000Z')
    expect(new Date(Number(variables.backfill_to)).toISOString()).toBe('2026-08-09T00:00:00.000Z')
  })

  test('every day of the window is named, oldest first', () => {
    const days = analyticsRange(new Date('2026-08-08T10:00:00Z'), 7)
    expect(days).toHaveLength(7)
    expect(days[0]).toBe('2026-08-02')
    expect(days.at(-1)).toBe('2026-08-08')
  })

  test('a day is the UTC day X bucketed it in', () => {
    expect(utcDayKey(Date.parse('2026-08-08T23:30:00Z'))).toBe('2026-08-08')
  })

  // The names are X's own: a quote counts as a post, and a reply is one you wrote, while the
  // Reply it also counts is a reply somebody left you.
  test('each kind of engagement lands in the column x.com puts it in', () => {
    const parsed = parseAnalytics(analyticsBody([
      row('TweetCreate', 7, '2026-08-05T00:00:00Z'),
      row('QuoteCreate', 4, '2026-08-05T00:00:00Z'),
      row('ReplyCreate', 70, '2026-08-05T00:00:00Z'),
      row('Displayed', 11624, '2026-08-05T00:00:00Z'),
      row('Follow', 6, '2026-08-05T00:00:00Z'),
      row('Unfollow', 1, '2026-08-05T00:00:00Z'),
      row('Reply', 42, '2026-08-05T00:00:00Z'),
      row('Fav', 78, '2026-08-05T00:00:00Z')
    ]))
    expect(parsed['2026-08-05']).toEqual({ posts: 11, replies: 70, impressions: 11624, follows: 6, unfollows: 1 })
  })

  // The daily series runs two days behind, and the finer one fills that tail in.
  test('the finer series answers for the days the daily one has not reached', () => {
    const parsed = parseAnalytics(analyticsBody(
      [row('Displayed', 300, '2026-08-06T00:00:00Z')],
      [row('Displayed', 900, '2026-08-07T00:00:00Z'), row('ReplyCreate', 70, '2026-08-07T00:00:00Z')]
    ))
    expect(parsed['2026-08-07']).toMatchObject({ impressions: 900, replies: 70 })
    expect(parsed['2026-08-06']).toMatchObject({ impressions: 300 })
  })

  // x.com replaces the tail rather than adding to it, and stops at the newest day the daily
  // series already answered for, so a day both series carry is counted once.
  test('a day both series carry is not counted twice', () => {
    const parsed = parseAnalytics(analyticsBody(
      [row('Displayed', 300, '2026-08-07T00:00:00Z')],
      [row('Displayed', 900, '2026-08-07T00:00:00Z')]
    ))
    expect(parsed['2026-08-07']).toMatchObject({ impressions: 300 })
  })

  // X sends no row for a quiet day, and a quiet day is not an unknown day.
  test('a day with nothing on it reads as zero', () => {
    const parsed = parseAnalytics(analyticsBody([row('Displayed', 5, '2026-08-08T00:00:00Z')]), ['2026-08-06', '2026-08-07', '2026-08-08'])
    expect(parsed['2026-08-06']).toEqual({ posts: 0, replies: 0, impressions: 0, follows: 0, unfollows: 0 })
  })

  // X serves no analytics for a young account, and a page of zeros would read as a quiet
  // month rather than as an answer nobody gave.
  test('an answer with no series in it stays empty', () => {
    expect(parseAnalytics(analyticsBody([]), ['2026-08-08'])).toEqual({})
    expect(parseAnalytics({ data: {} }, ['2026-08-08'])).toEqual({})
  })
})

describe('what the profile timeline gives back', () => {
  // How X answers UserTweetsAndReplies: a pin instruction of its own, then the list. The
  // author block carries the counts, which is the only place a cookie session can read them.
  const userCard = (id: string, author: Record<string, unknown>): unknown => ({
    rest_id: id,
    core: { user_results: { result: author } },
    legacy: { full_text: `post ${id}`, created_at: 'Mon Aug 03 09:00:00 +0000 2026', conversation_id_str: id },
    views: { count: '7' }
  })

  const newShape = {
    rest_id: me,
    core: { screen_name: 'me', name: 'Me' },
    relationship_counts: { followers: 1059, following: 594 },
    tweet_counts: { tweets: 4656 }
  }

  const oldShape = {
    rest_id: me,
    legacy: { screen_name: 'me', name: 'Me', followers_count: 1059, friends_count: 594, statuses_count: 4656 }
  }

  const body = (author: Record<string, unknown>): unknown => ({
    data: {
      user: {
        result: {
          timeline_v2: {
            timeline: {
              instructions: [
                { type: 'TimelinePinEntry', entry: { entryId: 'tweet-999', content: { itemContent: { tweet_results: { result: userCard('999', author) } } } } },
                {
                  type: 'TimelineAddEntries',
                  entries: [
                    { entryId: 'tweet-1', content: { entryType: 'TimelineTimelineItem', itemContent: { tweet_results: { result: userCard('1', author) } } } },
                    { entryId: 'cursor-bottom-1', content: { cursorType: 'Bottom', value: 'next' } }
                  ]
                }
              ]
            }
          }
        }
      }
    }
  })

  test('the counts come off the author of your own card', () => {
    const instructions = getUserTimelineInstructions(body(newShape))
    expect(parseTimelineProfile(instructions, me)).toEqual({ id: me, handle: 'me', name: 'Me', followers: 1059, following: 594, posts: 4656 })
  })

  test('a session still served the old shape reads the same', () => {
    expect(parseTimelineProfile(getUserTimelineInstructions(body(oldShape)), me)).toMatchObject({ followers: 1059, posts: 4656 })
  })

  test('another account on the page is not you', () => {
    expect(parseTimelineProfile(getUserTimelineInstructions(body(newShape)), 'u2')).toBeUndefined()
  })

  test('the pinned tweet stays out of the list', () => {
    expect(parseUserTweets(getUserTimelineInstructions(body(newShape))).map((tweet) => tweet.id)).toEqual(['1'])
  })
})

describe('the table', () => {
  const rows = buildStatsRows({
    window: 7,
    now,
    history: history({
      '2026-08-08': { posts: 1, replies: 0, impressions: 12345, follows: 12, unfollows: 2 },
      '2026-08-07': { posts: 0, replies: 1, impressions: 6, follows: 0, unfollows: 0 },
      '2026-08-06': { posts: 0, replies: 0, impressions: 0, follows: 0, unfollows: 0 },
      '2026-08-05': { posts: 0, replies: 0, impressions: 0, follows: 0, unfollows: 0 }
    })
  })

  test('a count reads as a count and a change reads as a change', () => {
    expect(formatCount(12345)).toBe('12,345')
    expect(formatChange(12)).toBe('+12')
    expect(formatChange(-12)).toBe('-12')
    expect(formatChange(undefined)).toBe('·')
  })

  test('every column ends under its header', () => {
    const lines = statsTableLines(rows, statsTotals(rows), now)
    const header = lines[0] ?? ''
    expect(header.startsWith('Day')).toBe(true)
    // Every number is right-aligned, so the last character of a cell sits under the last
    // character of its header, and the column after it starts with a space.
    for (const column of ['Posts', 'Replies', 'Impressions', 'Followers']) {
      const end = header.indexOf(column) + column.length
      for (const line of lines) {
        expect(line).toHaveLength(header.length)
        expect(line[end - 1]).not.toBe(' ')
        expect(line.slice(end, end + 1)).not.toMatch(/\S/)
      }
    }
  })

  test('a day X answered nothing for shows no numbers to read', () => {
    const lines = statsTableLines(rows, statsTotals(rows), now)
    expect(lines[1]).toContain('Today')
    expect(lines[1]).toContain('12,345')
    expect(lines.at(-3)).toContain('·')
    expect(lines.at(-1)).toContain('Total')
  })

  test('the head names the account and the note names where the numbers come from', () => {
    const body = statsBodyLines({ rows, totals: statsTotals(rows), profile, window: 14, loading: false, now })
    expect(body[0]).toContain('@me')
    expect(body[0]).toContain('1,200 followers')
    expect(body.join('\n')).toContain('Impressions are the views everything of yours drew')
    expect(body.join('\n')).toContain('X counts its days in UTC')
  })

  test('a window with no account behind it still says which window it is', () => {
    expect(statsHeadline(undefined, 30)).toBe('Last 30 days')
  })

  test('a failed load says why, and says which key tries again', () => {
    const body = statsBodyLines({ rows: [], window: 7, loading: false, error: 'x sent 404', now })
    expect(body.join('\n')).toContain('x sent 404')
    expect(body.join('\n')).toContain('R tries again')
  })

  test('a load that is still running says so', () => {
    expect(statsBodyLines({ rows: [], window: 7, loading: true, now }).join('\n')).toContain('Reading your stats')
  })
})

describe('the page on the screen', () => {
  const stateWith = (over: Partial<ReturnType<typeof initialAppState>['stats']>) => {
    const rows = buildStatsRows({ window: 7, now, history: history({ '2026-08-08': { impressions: 4321 } }) })
    const loaded = mergeTimelinePage(initialAppState(), 'following', [mine('1')], {})
    return { ...loaded, stats: { ...loaded.stats, open: true, rows, totals: statsTotals(rows), profile, ...over } }
  }

  const frameOf = async (state: ReturnType<typeof stateWith>, width = 120, height = 40): Promise<string> => {
    const harness = await createTestRenderer({ width, height })
    const screen = createMainScreen(harness.renderer)
    screen.render(state)
    await harness.flush()
    screen.render(state)
    await harness.flush()
    return harness.captureCharFrame()
  }

  test('an open page shows the table over the feed', async () => {
    const frame = await frameOf(stateWith({}))
    expect(frame).toContain(' Stats ')
    expect(frame).toContain('Impressions')
    expect(frame).toContain('4,321')
    expect(frame).toContain('w changes the window')
  })

  test('a closed page leaves the feed alone', async () => {
    const frame = await frameOf(stateWith({ open: false }))
    expect(frame).not.toContain(' Stats ')
  })

  test('the key list names the page', async () => {
    const frame = await frameOf({ ...stateWith({ open: false }), helpOpen: true })
    expect(frame).toContain('your stats, on and off')
  })

  // A picture is painted over the grid, so an avatar behind the page would show through it.
  test('holds back the pictures while it is up', async () => {
    const harness = await createTestRenderer({ width: 120, height: 40 })
    const screen = createMainScreen(harness.renderer)
    const shown = stateWith({ open: false })
    const withAvatar = mergeTimelinePage(shown, 'following', [{ ...mine('1'), author: { ...mine('1').author, avatarUrl: 'https://x.test/a.jpg' } }], {})
    screen.render(withAvatar)
    await harness.flush()
    screen.render(withAvatar)
    await harness.flush()
    expect(screen.placements().length).toBeGreaterThan(0)
    screen.render({ ...withAvatar, stats: { ...withAvatar.stats, open: true } })
    await harness.flush()
    expect(screen.placements()).toEqual([])
  })

  // A window too short for thirty days has to scroll, and say that it does.
  test('a short window scrolls the days it cannot hold', async () => {
    const rows = buildStatsRows({ window: 30, now, history: {} })
    const tall = statsBodyLines({ rows, totals: statsTotals(rows), profile, window: 30, loading: false, now })
    expect(statsScrollMaxOf(tall, 20)).toBeGreaterThan(0)
    expect(statsScrollMaxOf(tall, 60)).toBe(0)
    const frame = await frameOf({ ...stateWith({ window: 30, rows, totals: statsTotals(rows) }) }, 120, 20)
    expect(frame).toContain('↑ ↓ scrolls')
  })
})
