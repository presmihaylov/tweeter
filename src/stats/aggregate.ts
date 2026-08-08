import type { AnalyticsHistory } from '../twitter/analytics.ts'

// The three windows the page offers. X's own analytics never look further back than a month
// either, and a longer one would say less than it seems to.
export const statsWindows = [7, 14, 30] as const

export type StatsWindow = (typeof statsWindows)[number]

export const nextStatsWindow = (window: StatsWindow): StatsWindow => {
  const index = statsWindows.indexOf(window)
  return statsWindows[(index + 1) % statsWindows.length] ?? statsWindows[0]
}

// One day of the page. `covered` says X answered for that day: a day it says nothing about
// has to read as unknown rather than as a quiet day.
export type StatsRow = {
  day: string
  posts: number
  replies: number
  impressions: number
  followerChange?: number
  covered: boolean
}

const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const pad = (value: number): string => String(value).padStart(2, '0')

// The day the machine is in, not the day UTC is in. X buckets its own counts by UTC day, so
// the two can sit a few hours apart, which is what the note under the table says.
export const dayKey = (date: Date): string => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

export const dayLabel = (day: string, now: Date): string => {
  const date = new Date(`${day}T12:00:00`)
  if (Number.isNaN(date.getTime())) {
    return day
  }
  if (day === dayKey(now)) {
    return 'Today'
  }
  return `${weekdays[date.getDay()] ?? ''} ${pad(date.getDate())} ${months[date.getMonth()] ?? ''}`
}

// Newest first, the way the rows are drawn.
export const recentDays = (now: Date, count: number): string[] => {
  const days: string[] = []
  for (let back = 0; back < count; back += 1) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back)
    days.push(dayKey(date))
  }
  return days
}

export const buildStatsRows = (args: { window: StatsWindow; now: Date; history: AnalyticsHistory }): StatsRow[] =>
  recentDays(args.now, args.window).map((day) => {
    const counted = args.history[day]
    return {
      day,
      posts: counted?.posts ?? 0,
      replies: counted?.replies ?? 0,
      impressions: counted?.impressions ?? 0,
      followerChange: counted ? counted.follows - counted.unfollows : undefined,
      covered: counted !== undefined
    }
  })

export type StatsTotals = { posts: number; replies: number; impressions: number; followerChange?: number }

export const statsTotals = (rows: StatsRow[]): StatsTotals => {
  const counted = rows.filter((row) => row.covered)
  return {
    posts: counted.reduce((sum, row) => sum + row.posts, 0),
    replies: counted.reduce((sum, row) => sum + row.replies, 0),
    impressions: counted.reduce((sum, row) => sum + row.impressions, 0),
    followerChange: counted.length === 0 ? undefined : counted.reduce((sum, row) => sum + (row.followerChange ?? 0), 0)
  }
}
