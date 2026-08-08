import { getInt, getMap, getSlice, getStr } from '../utils/guards.ts'

// One day of x.com's own account analytics. A post is a tweet or a quote, a reply is one you
// wrote, and an impression is a view of anything of yours, an old post as much as a new one.
export type AnalyticsDay = {
  posts: number
  replies: number
  impressions: number
  follows: number
  unfollows: number
}

// Keyed by calendar day. X buckets these in UTC, and so do its own analytics page and the CSV
// that page exports, so the key is the UTC date of the bucket.
export type AnalyticsHistory = Record<string, AnalyticsDay>

const dayMs = 86_400_000

const utcMidnight = (date: Date): number => Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())

export const analyticsVariables = (now: Date, days: number): Record<string, unknown> => {
  const to = utcMidnight(now) + dayMs
  const from = to - days * dayMs
  const previousFrom = from - (to - from)
  // The daily series stops about two days short of now, so x.com asks a second, finer series
  // for the tail. Yesterday and today come from that one.
  const backfillFrom = utcMidnight(now) - dayMs
  return {
    backfill_from: backfillFrom,
    backfill_to: backfillFrom + 2 * dayMs,
    current_from: from,
    current_from_iso: new Date(from).toISOString(),
    current_to: to,
    current_to_iso: new Date(to).toISOString(),
    prev_from: previousFrom,
    prev_from_iso: new Date(previousFrom).toISOString(),
    prev_to: from,
    prev_to_iso: new Date(from).toISOString(),
    show_verified_followers: false
  }
}

// Every day the request asked about, oldest first. A day X sends nothing for is a quiet day
// rather than an unknown one, so it has to be named here to come back as a row of zeros.
export const analyticsRange = (now: Date, days: number): string[] => {
  const to = utcMidnight(now) + dayMs
  const keys: string[] = []
  for (let back = days; back > 0; back -= 1) {
    keys.push(utcDayKey(to - back * dayMs))
  }
  return keys
}

const pad = (value: number): string => String(value).padStart(2, '0')

export const utcDayKey = (ms: number): string => {
  const date = new Date(ms)
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

const emptyDay = (): AnalyticsDay => ({ posts: 0, replies: 0, impressions: 0, follows: 0, unfollows: 0 })

// What each kind of engagement adds to, taken from the map the analytics page itself uses. X
// counts dozens of other kinds, and they are about what people did to your posts rather than
// about the four numbers this page shows. A quote counts as a post, the way x.com counts it.
const fieldOfKind: Readonly<Record<string, keyof AnalyticsDay>> = {
  TweetCreate: 'posts',
  QuoteCreate: 'posts',
  ReplyCreate: 'replies',
  Displayed: 'impressions',
  Follow: 'follows',
  Unfollow: 'unfollows'
}

const dayOfRows = (rows: unknown[]): AnalyticsDay => {
  const day = emptyDay()
  for (const row of rows) {
    const field = fieldOfKind[getStr(row, 'engagement_type')]
    if (field) {
      day[field] += getInt(row, 'count')
    }
  }
  return day
}

const byDay = (rows: unknown[]): Record<string, unknown[]> => {
  const groups: Record<string, unknown[]> = {}
  for (const row of rows) {
    const timestamp = getInt(row, 'timestamp')
    if (timestamp === 0) {
      continue
    }
    const group = groups[utcDayKey(timestamp)] ?? []
    group.push(row)
    groups[utcDayKey(timestamp)] = group
  }
  return groups
}

// Both series carry every kind of engagement in one flat list, one row per day per kind. An
// empty answer stays empty: X serves no analytics for a young account, and a page of zeros
// would read as a quiet month rather than as an answer nobody gave.
export const parseAnalytics = (body: unknown, days: string[] = []): AnalyticsHistory => {
  const result = getMap(getMap(getMap(getMap(body, 'data'), 'viewer_v2'), 'user_results'), 'result')
  const current = byDay(getSlice(result, 'current_time_series') ?? [])
  const backfill = byDay(getSlice(result, 'hourly_backfill') ?? [])
  if (Object.keys(current).length === 0 && Object.keys(backfill).length === 0) {
    return {}
  }
  const history: AnalyticsHistory = {}
  for (const day of [...days, ...Object.keys(current), ...Object.keys(backfill)]) {
    history[day] = emptyDay()
  }
  for (const [day, rows] of Object.entries(current)) {
    history[day] = dayOfRows(rows)
  }
  // The finer series replaces the tail rather than adding to it, and the tail ends at the
  // newest day the daily series already has impressions for. That is what x.com does, and it
  // is what keeps a day both series speak for from being counted twice.
  for (const day of Object.keys(history).sort().reverse()) {
    if ((history[day]?.impressions ?? 0) > 0) {
      break
    }
    const rows = backfill[day]
    if (rows) {
      history[day] = dayOfRows(rows)
    }
  }
  return history
}
