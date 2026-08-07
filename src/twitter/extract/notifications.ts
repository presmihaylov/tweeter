import type { AppNotice, NoticeIcon, NoticeList, NotificationPage, NotificationRow } from '../types.ts'
import { getInt, getMap, getSlice, getStr } from '../../utils/guards.ts'
import { parseLegacyTweets } from './legacyTweet.ts'

// X names the icon rather than the kind of event, so the icon is what the row is read from.
const noticeIconFor = (icon: string): NoticeIcon => {
  if (icon === 'heart_icon') {
    return 'like'
  }
  if (icon === 'retweet_icon') {
    return 'repost'
  }
  if (icon === 'person_icon') {
    return 'follow'
  }
  if (icon === 'bell_icon') {
    return 'bell'
  }
  return 'other'
}

// The old REST API stamps a notification in milliseconds. relativeTime reads a date string,
// so the stamp becomes one here rather than in the screen.
const isoFromMillis = (millis: number): string | undefined => {
  if (millis <= 0) {
    return undefined
  }
  const stamp = new Date(millis)
  return Number.isNaN(stamp.getTime()) ? undefined : stamp.toISOString()
}

// The template names the users the line aggregates. The first of them owns the avatar the
// row draws, the way x.com puts one face beside "Ann and 2 others liked your post".
const firstUserId = (notification: unknown): string => {
  const template = getMap(getMap(notification, 'template'), 'aggregateUserActionsV1')
  const fromUser = getSlice(template, 'fromUsers')?.[0]
  return getStr(getMap(fromUser, 'user'), 'id')
}

// The same template names what the line is about. Only a tweet is something this app can
// open, so a target of any other kind leaves the row without one.
const firstTargetTweetId = (notification: unknown): string | undefined => {
  const template = getMap(getMap(notification, 'template'), 'aggregateUserActionsV1')
  const target = getSlice(template, 'targetObjects')?.[0]
  return getStr(getMap(target, 'tweet'), 'id') || undefined
}

// The entry, not the notice, says where the line leads. A tweet of yours is an ExternalUrl and
// the template already names it; a list of somebody else's posts is a UrtEndpoint on a path of
// its own, which is where the bell line and an aggregated like keep what they stand for.
const noticeListFor = (item: unknown): NoticeList | undefined => {
  const url = getMap(getMap(item, 'notification'), 'url')
  const path = getStr(url, 'url')
  if (getStr(url, 'urlType') !== 'UrtEndpoint' || !path.startsWith('/2/')) {
    return undefined
  }
  const options = getMap(url, 'urtEndpointOptions')
  // X writes the title and the subtitle as the two halves of one heading: "Liked" and "by Ann".
  const title = [getStr(options, 'title'), getStr(options, 'subtitle')].filter((part) => part !== '').join(' ')
  return { path, title: title || 'Posts' }
}

const noticeFor = (notification: unknown, item: unknown, users: unknown): AppNotice | undefined => {
  const text = getStr(getMap(notification, 'message'), 'text')
  if (text === '') {
    return undefined
  }
  const avatarUrl = getStr(getMap(users, firstUserId(notification)), 'profile_image_url_https')
  return stripUndefined({
    icon: noticeIconFor(getStr(getMap(notification, 'icon'), 'id')),
    text,
    avatarUrl: avatarUrl || undefined,
    createdAt: isoFromMillis(getInt(notification, 'timestampMs')),
    list: noticeListFor(item)
  })
}

// The notifications timeline is the old REST shape: instructions carry entries, an entry
// points at an id, and globalObjects holds the tweets, the users and the notices themselves.
export const parseNotificationsPage = (body: unknown): NotificationPage => {
  const globalObjects = getMap(body, 'globalObjects')
  const users = getMap(globalObjects, 'users')
  const notifications = getMap(globalObjects, 'notifications')
  const tweets = parseLegacyTweets(globalObjects)
  const known = new Set(tweets.map((tweet) => tweet.id))
  const rows: NotificationRow[] = []
  const seen = new Set<string>()
  let topCursor: string | undefined
  let bottomCursor: string | undefined
  for (const instruction of getSlice(getMap(body, 'timeline'), 'instructions') ?? []) {
    for (const entry of getSlice(getMap(instruction, 'addEntries'), 'entries') ?? []) {
      const key = getStr(entry, 'entryId')
      const content = getMap(entry, 'content')
      const cursor = getMap(getMap(content, 'operation'), 'cursor')
      if (cursor) {
        const value = getStr(cursor, 'value')
        if (getStr(cursor, 'cursorType') === 'Top' && value !== '') {
          topCursor = value
        }
        if (getStr(cursor, 'cursorType') === 'Bottom' && value !== '') {
          bottomCursor = value
        }
        continue
      }
      if (key === '' || seen.has(key)) {
        continue
      }
      const item = getMap(getMap(content, 'item'), 'content')
      const tweetId = getStr(getMap(item, 'tweet'), 'id')
      if (tweetId !== '') {
        // A mention or an answer arrives as the tweet itself, with no line above it.
        if (known.has(tweetId)) {
          seen.add(key)
          rows.push({ key, tweetId })
        }
        continue
      }
      const notification = getMap(notifications, getStr(getMap(item, 'notification'), 'id'))
      const notice = noticeFor(notification, item, users)
      if (!notice) {
        continue
      }
      seen.add(key)
      const target = firstTargetTweetId(notification)
      rows.push(stripUndefined({ key, tweetId: target !== undefined && known.has(target) ? target : undefined, notice }))
    }
  }
  return stripUndefined({ rows, tweets, topCursor, bottomCursor })
}

const stripUndefined = <T extends Record<string, unknown>>(value: T): T => {
  return Object.fromEntries(Object.entries(value).filter((entry) => entry[1] !== undefined)) as T
}
