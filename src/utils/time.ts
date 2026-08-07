export const nowIso = (): string => new Date().toISOString()

const second = 1000
const minute = 60 * second
const hour = 60 * minute
const day = 24 * hour
const week = 7 * day

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// X sends "Wed Aug 06 21:14:03 +0000 2026". Date reads that, but a tweet without the field
// must not become a NaN clock on the screen, so a bad value answers with nothing.
export const parseTweetTime = (value: string | undefined): Date | undefined => {
  if (value === undefined || value === '') {
    return undefined
  }
  const posted = new Date(value)
  return Number.isNaN(posted.getTime()) ? undefined : posted
}

const calendarDay = (posted: Date, now: Date): string => {
  const stamp = `${months[posted.getMonth()] ?? ''} ${posted.getDate()}`
  return posted.getFullYear() === now.getFullYear() ? stamp : `${stamp}, ${posted.getFullYear()}`
}

// A card has room for one small stamp, so it counts up in seconds, minutes, hours and days
// the way x.com does. Past a week the gap stops meaning anything and the date says more.
// A tweet that claims the future is clock skew between the machine and X, not a real date.
export const relativeTime = (value: string | undefined, now: Date): string => {
  const posted = parseTweetTime(value)
  if (!posted) {
    return ''
  }
  const gap = now.getTime() - posted.getTime()
  if (gap < minute) {
    return gap < 5 * second ? 'now' : `${Math.floor(gap / second)}s`
  }
  if (gap < hour) {
    return `${Math.floor(gap / minute)}m`
  }
  if (gap < day) {
    return `${Math.floor(gap / hour)}h`
  }
  if (gap < week) {
    return `${Math.floor(gap / day)}d`
  }
  return calendarDay(posted, now)
}

// The open tweet has room for the whole stamp, so it reads as a clock and a date in the
// reader's own timezone, the way x.com writes it under a post.
export const absoluteTime = (value: string | undefined): string => {
  const posted = parseTweetTime(value)
  if (!posted) {
    return ''
  }
  const hours = posted.getHours()
  const clock = `${((hours + 11) % 12) + 1}:${String(posted.getMinutes()).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`
  return `${clock} · ${months[posted.getMonth()] ?? ''} ${posted.getDate()}, ${posted.getFullYear()}`
}
