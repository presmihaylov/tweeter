import type { AppProfile, AppTweet, UserTimelinePage } from '../twitter/types.ts'
import { dayOfTweet, isOwnWriting, recentDays, type StatsWindow } from './aggregate.ts'

export type StatsReader = {
  loadUserTweetsPage: (args: { userId: string; count: number; cursor?: string }) => Promise<UserTimelinePage>
}

// X serves about thirty-six cards whatever count the request asks for, and half of them are
// the tweets your replies answer. A busy day therefore costs a page or two of its own.
export const statsPageSize = 40

// How far back the walk goes before it gives up. A wider window needs more pages, and the
// ceiling keeps a heavy month from paging through a whole history for four numbers.
export const statsPageCapFor = (window: StatsWindow): number => Math.min(60, window * 2)

export type StatsLoad = {
  tweets: AppTweet[]
  profile?: AppProfile
  // True when the timeline ran out before the window did, which makes every row complete.
  exhausted: boolean
  pages: number
}

export const loadStatsTweets = async (args: {
  client: StatsReader
  userId: string
  window: StatsWindow
  now: Date
  pageCap?: number
  // Called with everything fetched so far, so the table fills in page by page instead of
  // holding an empty card for the half minute a month of tweets takes.
  onPage?: (load: StatsLoad) => void
}): Promise<StatsLoad> => {
  const { client, userId, window, now, pageCap = statsPageCapFor(window), onPage } = args
  const first = recentDays(now, window).at(-1) ?? ''
  const tweets: AppTweet[] = []
  let profile: AppProfile | undefined
  let cursor: string | undefined
  let pages = 0
  while (pages < pageCap) {
    const page: UserTimelinePage = await client.loadUserTweetsPage({ userId, count: statsPageSize, cursor })
    pages += 1
    tweets.push(...page.tweets)
    profile = profile ?? page.profile
    cursor = page.bottomCursor
    const ranOut = page.tweets.length === 0 || cursor === undefined
    const covered = reachesBack(page.tweets, userId, first)
    const load: StatsLoad = { tweets: [...tweets], profile, exhausted: ranOut, pages }
    onPage?.(load)
    if (ranOut || covered) {
      return load
    }
  }
  return { tweets, profile, exhausted: false, pages }
}

// The timeline runs newest first, so one card older than the window means the window is full.
const reachesBack = (tweets: AppTweet[], userId: string, first: string): boolean =>
  tweets.some((tweet) => {
    const day = dayOfTweet(tweet)
    return day !== undefined && day < first && isOwnWriting(tweet, userId)
  })
