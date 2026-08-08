import { describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createTestRenderer } from '@opentui/core/testing'
import { isStatsKey } from '../src/app/keyEvents.ts'
import { buildStatsRows, coveredFromOf, dayKey, dayLabel, nextStatsWindow, previousDay, recentDays, statsTotals } from '../src/stats/aggregate.ts'
import { readFollowerLog, recordFollowers, writeFollowerLog } from '../src/stats/followerLog.ts'
import { loadStatsTweets, statsPageCapFor, statsPageSize } from '../src/stats/load.ts'
import { formatChange, formatCount, statsBodyLines, statsHeadline, statsTableLines } from '../src/app/statsView.ts'
import { createMainScreen, statsScrollMaxOf } from '../src/app/mainScreen.ts'
import { getUserTimelineInstructions, parseTimelineProfile, parseUserTweets } from '../src/twitter/extract/tweet.ts'
import { beginStatsLoad, closeStats, failStatsLoad, initialAppState, mergeStats, mergeTimelinePage, scrollStats, toggleHelp, toggleStats, turnStatsWindow } from '../src/state/store.ts'
import type { AppKey } from '../src/app/keyEvents.ts'
import type { AppProfile, AppTweet, UserTimelinePage } from '../src/twitter/types.ts'

const key = (over: Partial<AppKey>): AppKey => ({ name: '', ctrl: false, ...over })

const me = 'u1'
const now = new Date(2026, 7, 8, 10, 0, 0)

// A day of the window, as a date X would stamp on a tweet.
const stamp = (daysBack: number, hour = 12): string =>
  new Date(2026, 7, 8 - daysBack, hour, 30, 0).toISOString()

const mine = (id: string, over: Partial<AppTweet> = {}): AppTweet => ({
  id,
  text: `post ${id}`,
  author: { id: me, handle: 'me', name: 'Me' },
  createdAt: stamp(0),
  media: [],
  metrics: { views: 100 },
  ...over
})

const profile: AppProfile = { id: me, handle: 'me', name: 'Me', followers: 1200, following: 300, posts: 4500 }

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
    const rows = buildStatsRows({ tweets: [mine('1')], userId: me, window: 7, now })
    const merged = mergeStats(beginStatsLoad(toggleStats(initialAppState())), { rows, totals: statsTotals(rows), profile, loadedWindow: 7 })
    expect(merged.stats.loading).toBe(false)
    expect(merged.stats.rows).toHaveLength(7)
    expect(merged.stats.loadedWindow).toBe(7)
    expect(merged.stats.profile?.followers).toBe(1200)
  })

  test('a page that is not the last one leaves the load running', () => {
    const rows = buildStatsRows({ tweets: [mine('1')], userId: me, window: 30, now, coveredFrom: '2026-08-05' })
    const merged = mergeStats(beginStatsLoad(toggleStats(initialAppState())), { rows, totals: statsTotals(rows), loadedWindow: 30, loading: true })
    expect(merged.stats.loading).toBe(true)
    expect(merged.stats.rows).toHaveLength(30)
  })
})

describe('the days', () => {
  test('a day is the day the machine is in', () => {
    expect(dayKey(new Date(2026, 7, 8, 1, 0, 0))).toBe('2026-08-08')
    expect(previousDay('2026-08-01')).toBe('2026-07-31')
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

describe('what the rows count', () => {
  test('a post and a reply land in their own columns, on their own day', () => {
    const rows = buildStatsRows({
      tweets: [
        mine('1', { metrics: { views: 900 } }),
        mine('2', { inReplyToStatusId: '99', metrics: { views: 100 } }),
        mine('3', { createdAt: stamp(1), metrics: { views: 40 } })
      ],
      userId: me,
      window: 7,
      now
    })
    expect(rows[0]).toMatchObject({ day: '2026-08-08', posts: 1, replies: 1, impressions: 1000 })
    expect(rows[1]).toMatchObject({ day: '2026-08-07', posts: 1, replies: 0, impressions: 40 })
  })

  test('somebody else\'s tweet and your own repost of one are not yours to count', () => {
    const rows = buildStatsRows({
      tweets: [
        mine('1'),
        { ...mine('2'), author: { id: 'u2', handle: 'other', name: 'Other' } },
        mine('3', { repostedBy: { handle: 'me', name: 'Me' } })
      ],
      userId: me,
      window: 7,
      now
    })
    expect(rows[0]).toMatchObject({ posts: 1, impressions: 100 })
  })

  test('a tweet older than the window falls outside the rows', () => {
    const rows = buildStatsRows({ tweets: [mine('1', { createdAt: stamp(20) })], userId: me, window: 7, now })
    expect(statsTotals(rows).posts).toBe(0)
  })

  test('the total adds every row it was given', () => {
    const rows = buildStatsRows({
      tweets: [mine('1'), mine('2', { createdAt: stamp(3), inReplyToStatusId: '9' }), mine('3', { createdAt: stamp(3) })],
      userId: me,
      window: 7,
      now
    })
    expect(statsTotals(rows)).toMatchObject({ posts: 2, replies: 1, impressions: 300 })
  })

  test('a day the fetch never reached reads as unknown, not as zero', () => {
    const rows = buildStatsRows({ tweets: [mine('1')], userId: me, window: 7, now, coveredFrom: '2026-08-06' })
    expect(rows[0]?.covered).toBe(true)
    expect(rows[2]?.covered).toBe(true)
    expect(rows[3]?.covered).toBe(false)
  })

  test('the covered day is the oldest one fetched, and everything when the timeline ran out', () => {
    const tweets = [mine('1'), mine('2', { createdAt: stamp(4) })]
    expect(coveredFromOf({ tweets, userId: me, exhausted: false, now })).toBe('2026-08-04')
    expect(coveredFromOf({ tweets, userId: me, exhausted: true, now })).toBeUndefined()
  })
})

describe('the follower change', () => {
  test('a day names a change only when the day before was counted too', () => {
    const followers = { '2026-08-08': 1210, '2026-08-07': 1200 }
    const rows = buildStatsRows({ tweets: [], userId: me, window: 7, now, followers })
    expect(rows[0]?.followerChange).toBe(10)
    expect(rows[1]?.followerChange).toBeUndefined()
  })

  test('a lost follower reads as a loss', () => {
    const followers = { '2026-08-08': 1190, '2026-08-07': 1200, '2026-08-06': 1150 }
    const rows = buildStatsRows({ tweets: [], userId: me, window: 7, now, followers })
    expect(rows[0]?.followerChange).toBe(-10)
    expect(rows[1]?.followerChange).toBe(50)
    expect(statsTotals(rows).followerChange).toBe(40)
  })

  test('no sample at all leaves the total without a change', () => {
    expect(statsTotals(buildStatsRows({ tweets: [], userId: me, window: 7, now })).followerChange).toBeUndefined()
  })
})

describe('the follower log', () => {
  const logPath = async (): Promise<string> => join(await mkdtemp(join(tmpdir(), 'tweeter-stats-')), 'followers.json')

  test('a missing file is an empty log, not an error', async () => {
    expect(await readFollowerLog(await logPath())).toEqual({})
  })

  test('what one run wrote the next run reads', async () => {
    const path = await logPath()
    await writeFollowerLog(recordFollowers({}, 1200, now), path)
    expect(await readFollowerLog(path)).toEqual({ '2026-08-08': 1200 })
  })

  test('the last count of the day wins', () => {
    const log = recordFollowers(recordFollowers({}, 1200, now), 1205, new Date(2026, 7, 8, 22, 0, 0))
    expect(log['2026-08-08']).toBe(1205)
  })

  test('a count older than the file keeps is dropped', () => {
    const log = recordFollowers({ '2026-01-01': 900, '2026-08-07': 1190 }, 1200, now)
    expect(log['2026-01-01']).toBeUndefined()
    expect(log['2026-08-07']).toBe(1190)
  })

  test('a file that is not a log of numbers reads as empty', async () => {
    const path = await logPath()
    await Bun.write(path, JSON.stringify({ '2026-08-08': 'many', '2026-08-07': 1190 }))
    expect(await readFollowerLog(path)).toEqual({ '2026-08-07': 1190 })
  })
})

describe('the fetch behind the page', () => {
  const pageOf = (tweets: AppTweet[], bottomCursor?: string): UserTimelinePage => ({ tweets, profile, bottomCursor })

  test('it stops as soon as one page reaches past the window', async () => {
    const asked: Array<string | undefined> = []
    const load = await loadStatsTweets({
      client: {
        loadUserTweetsPage: async (args) => {
          asked.push(args.cursor)
          expect(args.count).toBe(statsPageSize)
          return asked.length === 1
            ? pageOf([mine('1'), mine('2', { createdAt: stamp(3) })], 'c1')
            : pageOf([mine('3', { createdAt: stamp(9) })], 'c2')
        }
      },
      userId: me,
      window: 7,
      now
    })
    expect(asked).toEqual([undefined, 'c1'])
    expect(load.tweets).toHaveLength(3)
    expect(load.profile?.handle).toBe('me')
    expect(load.exhausted).toBe(false)
  })

  test('a timeline that runs out covers every day of the window', async () => {
    const load = await loadStatsTweets({
      client: { loadUserTweetsPage: async () => pageOf([mine('1')]) },
      userId: me,
      window: 30,
      now
    })
    expect(load.exhausted).toBe(true)
    expect(load.pages).toBe(1)
  })

  test('it gives up rather than page back through a whole history', async () => {
    const load = await loadStatsTweets({
      client: { loadUserTweetsPage: async () => pageOf([mine('1')], 'more') },
      userId: me,
      window: 30,
      now,
      pageCap: 3
    })
    expect(load.pages).toBe(3)
    expect(load.exhausted).toBe(false)
  })

  test('a wider window may walk further back', () => {
    expect(statsPageCapFor(7)).toBe(14)
    expect(statsPageCapFor(14)).toBe(28)
    expect(statsPageCapFor(30)).toBe(60)
  })

  test('every page is handed over as it lands, so the table fills in', async () => {
    const seen: number[] = []
    await loadStatsTweets({
      client: {
        loadUserTweetsPage: async () => (seen.length < 2 ? pageOf([mine('1')], 'c1') : pageOf([mine('2', { createdAt: stamp(9) })], 'c2'))
      },
      userId: me,
      window: 7,
      now,
      onPage: (partial) => { seen.push(partial.tweets.length) }
    })
    expect(seen).toEqual([1, 2, 3])
  })

  test('a page handed over is a copy, so a later page cannot change it', async () => {
    const seen: AppTweet[][] = []
    await loadStatsTweets({
      client: {
        loadUserTweetsPage: async () => (seen.length < 1 ? pageOf([mine('1')], 'c1') : pageOf([mine('2', { createdAt: stamp(9) })], 'c2'))
      },
      userId: me,
      window: 7,
      now,
      onPage: (partial) => { seen.push(partial.tweets) }
    })
    expect(seen[0]).toHaveLength(1)
  })

  test('a page of nobody else\'s tweets does not end the walk', async () => {
    let pages = 0
    const load = await loadStatsTweets({
      client: {
        loadUserTweetsPage: async () => {
          pages += 1
          const old = { ...mine('x'), author: { id: 'u2', handle: 'other', name: 'Other' }, createdAt: stamp(40) }
          return pages === 1 ? pageOf([old], 'c1') : pageOf([mine('2', { createdAt: stamp(40) })], 'c2')
        }
      },
      userId: me,
      window: 7,
      now
    })
    expect(load.pages).toBe(2)
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

  // The pin is out of order, so counting it would tell the walk it had reached back further
  // than it has, and the oldest days would be left empty.
  test('the pinned tweet stays out of the list', () => {
    expect(parseUserTweets(getUserTimelineInstructions(body(newShape))).map((tweet) => tweet.id)).toEqual(['1'])
  })
})

describe('the table', () => {
  const rows = buildStatsRows({
    tweets: [mine('1', { metrics: { views: 12345 } }), mine('2', { createdAt: stamp(1), inReplyToStatusId: '9', metrics: { views: 6 } })],
    userId: me,
    window: 7,
    now,
    followers: { '2026-08-08': 1210, '2026-08-07': 1200 },
    coveredFrom: '2026-08-05'
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

  test('a day nobody fetched shows no numbers to read', () => {
    const lines = statsTableLines(rows, statsTotals(rows), now)
    expect(lines[1]).toContain('Today')
    expect(lines[1]).toContain('12,345')
    expect(lines.at(-3)).toContain('·')
    expect(lines.at(-1)).toContain('Total')
  })

  test('the head names the account and the note names what the numbers mean', () => {
    const body = statsBodyLines({ rows, totals: statsTotals(rows), profile, window: 14, loading: false, now })
    expect(body[0]).toContain('@me')
    expect(body[0]).toContain('1,200 followers')
    expect(body.join('\n')).toContain('Impressions are the views so far')
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
    expect(statsBodyLines({ rows: [], window: 7, loading: true, now }).join('\n')).toContain('Counting')
  })
})

describe('the page on the screen', () => {
  const stateWith = (over: Partial<ReturnType<typeof initialAppState>['stats']>) => {
    const rows = buildStatsRows({ tweets: [mine('1', { metrics: { views: 4321 } })], userId: me, window: 7, now })
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

  // A window too short for thirty days has to scroll, and say that it does.
  test('a short window scrolls the days it cannot hold', async () => {
    const rows = buildStatsRows({ tweets: [], userId: me, window: 30, now })
    const tall = statsBodyLines({ rows, totals: statsTotals(rows), profile, window: 30, loading: false, now })
    expect(statsScrollMaxOf(tall, 20)).toBeGreaterThan(0)
    expect(statsScrollMaxOf(tall, 60)).toBe(0)
    const frame = await frameOf({ ...stateWith({ window: 30, rows, totals: statsTotals(rows) }) }, 120, 20)
    expect(frame).toContain('↑ ↓ scrolls')
  })
})
