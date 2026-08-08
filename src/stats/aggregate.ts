import type { AppTweet } from '../twitter/types.ts'
import { parseTweetTime } from '../utils/time.ts'

// The three windows the page offers. X keeps no daily history of its own, so a longer one
// would only mean more pages of the profile timeline for the same four numbers.
export const statsWindows = [7, 14, 30] as const

export type StatsWindow = (typeof statsWindows)[number]

export const nextStatsWindow = (window: StatsWindow): StatsWindow => {
  const index = statsWindows.indexOf(window)
  return statsWindows[(index + 1) % statsWindows.length] ?? statsWindows[0]
}

// One day of the page. `covered` says the timeline reached that far back: a day nobody
// fetched has to read as unknown rather than as a day you wrote nothing.
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

// The day the machine is in, not the day UTC is in: a post at 1am counts for the night you
// wrote it. The key sorts as text, which is what the rows and the follower log both need.
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

export const dayOfTweet = (tweet: AppTweet): string | undefined => {
  const posted = parseTweetTime(tweet.createdAt)
  return posted ? dayKey(posted) : undefined
}

// A repost carries the original author's card, and a reply to somebody else's tweet arrives
// on the profile timeline beside the tweet it answers. Only what this account wrote counts.
export const isOwnWriting = (tweet: AppTweet, userId: string): boolean =>
  tweet.author.id === userId && tweet.repostedBy === undefined

export const buildStatsRows = (args: {
  tweets: AppTweet[]
  userId: string
  window: StatsWindow
  now: Date
  followers?: Record<string, number>
  coveredFrom?: string
}): StatsRow[] => {
  const { tweets, userId, window, now, followers = {}, coveredFrom } = args
  const days = recentDays(now, window)
  const counted = new Map<string, { posts: number; replies: number; impressions: number }>()
  for (const day of days) {
    counted.set(day, { posts: 0, replies: 0, impressions: 0 })
  }
  for (const tweet of tweets) {
    const day = dayOfTweet(tweet)
    if (day === undefined || !isOwnWriting(tweet, userId)) {
      continue
    }
    const row = counted.get(day)
    if (!row) {
      continue
    }
    const reply = tweet.inReplyToStatusId !== undefined
    counted.set(day, {
      posts: row.posts + (reply ? 0 : 1),
      replies: row.replies + (reply ? 1 : 0),
      impressions: row.impressions + (tweet.metrics.views ?? 0)
    })
  }
  return days.map((day) => {
    const row = counted.get(day) ?? { posts: 0, replies: 0, impressions: 0 }
    return {
      day,
      ...row,
      followerChange: followerChangeOn(followers, day),
      covered: coveredFrom === undefined || day >= coveredFrom
    }
  })
}

// X reports the follower count for right now and nothing else, so a change is the gap
// between two samples this app took. Only the day after a sample can name one.
const followerChangeOn = (followers: Record<string, number>, day: string): number | undefined => {
  const today = followers[day]
  const before = followers[previousDay(day)]
  if (today === undefined || before === undefined) {
    return undefined
  }
  return today - before
}

export const previousDay = (day: string): string => {
  const date = new Date(`${day}T12:00:00`)
  if (Number.isNaN(date.getTime())) {
    return day
  }
  date.setDate(date.getDate() - 1)
  return dayKey(date)
}

export type StatsTotals = { posts: number; replies: number; impressions: number; followerChange?: number }

export const statsTotals = (rows: StatsRow[]): StatsTotals => {
  const changes = rows.filter((row) => row.followerChange !== undefined)
  return {
    posts: rows.reduce((sum, row) => sum + row.posts, 0),
    replies: rows.reduce((sum, row) => sum + row.replies, 0),
    impressions: rows.reduce((sum, row) => sum + row.impressions, 0),
    followerChange: changes.length === 0 ? undefined : changes.reduce((sum, row) => sum + (row.followerChange ?? 0), 0)
  }
}

// The oldest day the fetched pages can speak for. A page that ran out of cursor covers
// everything, because there is nothing older to fetch.
export const coveredFromOf = (args: { tweets: AppTweet[]; userId: string; exhausted: boolean; now: Date }): string | undefined => {
  if (args.exhausted) {
    return undefined
  }
  const days = args.tweets.filter((tweet) => isOwnWriting(tweet, args.userId)).map(dayOfTweet).filter((day): day is string => day !== undefined)
  return days.reduce((oldest, day) => (day < oldest ? day : oldest), dayKey(args.now))
}
