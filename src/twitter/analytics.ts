import { getInt, getMap, getSlice, getStr } from '../utils/guards.ts'

// What X counted for one day: people who followed and people who left. The page shows the
// difference, but both halves are worth keeping, because a flat day and a busy day that
// cancels out are not the same day.
export type FollowerDay = { follows: number; unfollows: number }

// Keyed by calendar day, the way the rows are. X buckets these in UTC, and so does its own
// analytics page, so the key is the UTC date of the bucket.
export type FollowerHistory = Record<string, FollowerDay>

const dayMs = 86_400_000

const utcMidnight = (date: Date): number => Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())

export const followerHistoryVariables = (now: Date, days: number): Record<string, unknown> => {
  const to = utcMidnight(now) + dayMs
  const from = to - days * dayMs
  const previousFrom = from - (to - from)
  // The daily series stops about two days short of now, so x.com asks a second, finer
  // series for the tail. Yesterday and today come from that one.
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

// Every day the request asked about, oldest first. A day X sends nothing for is a day with
// no follows and no unfollows, and that is a zero rather than a blank.
export const followerHistoryRange = (now: Date, days: number): string[] => {
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

// Both series carry every kind of engagement in one flat list, one row per day per kind.
// Only two kinds move the follower count.
export const parseFollowerHistory = (body: unknown, days: string[] = []): FollowerHistory => {
  const result = getMap(getMap(getMap(getMap(body, 'data'), 'viewer_v2'), 'user_results'), 'result')
  if (!result) {
    return {}
  }
  const history: FollowerHistory = {}
  for (const day of days) {
    history[day] = { follows: 0, unfollows: 0 }
  }
  for (const field of ['current_time_series', 'hourly_backfill']) {
    for (const entry of getSlice(result, field) ?? []) {
      const kind = getStr(entry, 'engagement_type')
      const timestamp = getInt(entry, 'timestamp')
      if ((kind !== 'Follow' && kind !== 'Unfollow') || timestamp === 0) {
        continue
      }
      const day = utcDayKey(timestamp)
      const before = history[day] ?? { follows: 0, unfollows: 0 }
      const count = getInt(entry, 'count')
      history[day] = {
        follows: before.follows + (kind === 'Follow' ? count : 0),
        unfollows: before.unfollows + (kind === 'Unfollow' ? count : 0)
      }
    }
  }
  return history
}
