import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { configDir } from '../config/paths.ts'
import { readJsonFile, writeJsonFile } from '../utils/fs.ts'
import { isRecord } from '../utils/guards.ts'
import { dayKey } from './aggregate.ts'

// How many followers the account had, by day. X serves the count for right now and keeps no
// history, so the only way to know what a day changed is to write the count down every day
// the app runs. This lives beside the config rather than in the cache: a cache is thrown
// away, and a day that is thrown away can never be counted again.
export type FollowerLog = Record<string, number>

// Long enough to feed the widest window several times over, short enough to stay a small file.
const keptDays = 120

export const followerLogPath = (): string => join(configDir(), 'followers.json')

export const readFollowerLog = async (path = followerLogPath()): Promise<FollowerLog> => {
  if (!existsSync(path)) {
    return {}
  }
  try {
    return asLog(await readJsonFile(path))
  } catch {
    return {}
  }
}

export const writeFollowerLog = async (log: FollowerLog, path = followerLogPath()): Promise<void> => {
  await writeJsonFile(path, log)
}

// The last count of the day wins, because it is the one closest to the day's end.
export const recordFollowers = (log: FollowerLog, followers: number, now: Date): FollowerLog =>
  prune({ ...log, [dayKey(now)]: followers }, now)

const prune = (log: FollowerLog, now: Date): FollowerLog => {
  const oldest = new Date(now.getFullYear(), now.getMonth(), now.getDate() - keptDays)
  const kept: FollowerLog = {}
  for (const [day, count] of Object.entries(log)) {
    if (day >= dayKey(oldest)) {
      kept[day] = count
    }
  }
  return kept
}

const asLog = (value: unknown): FollowerLog => {
  if (!isRecord(value)) {
    return {}
  }
  const log: FollowerLog = {}
  for (const [day, count] of Object.entries(value)) {
    if (typeof count === 'number' && Number.isFinite(count)) {
      log[day] = count
    }
  }
  return log
}
