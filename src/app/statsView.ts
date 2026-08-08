import type { AppProfile } from '../twitter/types.ts'
import { dayLabel, type StatsRow, type StatsTotals, type StatsWindow } from '../stats/aggregate.ts'

const headers = ['Day', 'Posts', 'Replies', 'Impressions', 'Followers'] as const

// A day nobody fetched is not a day of zeros, so it says so instead of counting.
const unknown = '·'

export const formatCount = (value: number): string => value.toLocaleString('en-US')

// A follower change reads as a change, not as a count: the sign is the whole point.
export const formatChange = (value: number | undefined): string => {
  if (value === undefined) {
    return unknown
  }
  return value > 0 ? `+${formatCount(value)}` : formatCount(value)
}

const cellsOf = (row: StatsRow, now: Date): string[] => {
  if (!row.covered) {
    return [dayLabel(row.day, now), unknown, unknown, unknown, formatChange(row.followerChange)]
  }
  return [
    dayLabel(row.day, now),
    formatCount(row.posts),
    formatCount(row.replies),
    formatCount(row.impressions),
    formatChange(row.followerChange)
  ]
}

const totalCells = (totals: StatsTotals): string[] =>
  ['Total', formatCount(totals.posts), formatCount(totals.replies), formatCount(totals.impressions), formatChange(totals.followerChange)]

const columnGap = 2

// The day column reads left to right and every number reads right to left, the way a column
// of figures is read. The widths come from what is in the table, so a five-figure day of
// impressions moves the column instead of running into the one beside it.
export const statsTableLines = (rows: StatsRow[], totals: StatsTotals | undefined, now: Date): string[] => {
  const body = rows.map((row) => cellsOf(row, now))
  const foot = totals ? [totalCells(totals)] : []
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...[...body, ...foot].map((cells) => cells[column]?.length ?? 0))
  )
  const line = (cells: readonly string[]): string =>
    cells.map((cell, column) => (column === 0 ? cell.padEnd(widths[column] ?? 0) : cell.padStart(widths[column] ?? 0))).join(' '.repeat(columnGap)).trimEnd()
  const rule = widths.map((width) => '─'.repeat(width)).join(' '.repeat(columnGap))
  return [line(headers), ...body.map(line), ...(foot.length > 0 ? [rule, ...foot.map(line)] : [])]
}

export const statsHeadline = (profile: AppProfile | undefined, window: StatsWindow): string => {
  if (!profile) {
    return `Last ${window} days`
  }
  return `@${profile.handle} · ${formatCount(profile.followers)} followers · ${formatCount(profile.following)} following · ${formatCount(profile.posts)} posts`
}

// What the numbers do and do not mean. X gives no history for either one, so the page says
// where its own numbers come from rather than letting the reader assume.
export const statsNotes = (): string[] => [
  'Impressions are the views so far on what you wrote that day.',
  'A follower change needs a count from the day before, taken while tweeter ran.'
]

export const statsBodyLines = (args: {
  rows: StatsRow[]
  totals?: StatsTotals
  profile?: AppProfile
  window: StatsWindow
  loading: boolean
  error?: string
  now: Date
}): string[] => {
  const { rows, totals, profile, window, loading, error, now } = args
  const head = [statsHeadline(profile, window), '']
  if (error !== undefined) {
    return [...head, `Could not read your profile timeline: ${error}`, '', 'R tries again.']
  }
  if (rows.length === 0) {
    return [...head, loading ? 'Counting your days…' : 'Nothing counted yet.']
  }
  const waiting = loading ? ['', 'Counting further back…'] : []
  return [...head, ...statsTableLines(rows, totals, now), '', ...statsNotes(), ...waiting]
}
