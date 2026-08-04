import { existsSync } from 'node:fs'
import { z } from 'zod'
import { birdgoConfigPath } from './paths.ts'
import type { TweeterConfig } from './schema.ts'
import { nowIso } from '../utils/time.ts'
import { readJsonFile } from '../utils/fs.ts'

const birdgoProfileSchema = z.object({
  authToken: z.string().min(1),
  ct0: z.string().min(1)
})

const birdgoConfigSchema = z.object({
  profiles: z.record(z.string(), birdgoProfileSchema).default({}),
  defaultProfile: z.string().optional()
})

export const canImportBirdgoConfig = (path = birdgoConfigPath()): boolean => existsSync(path)

export const importBirdgoConfig = async (path = birdgoConfigPath()): Promise<TweeterConfig | undefined> => {
  if (!existsSync(path)) {
    return undefined
  }
  const parsed = birdgoConfigSchema.safeParse(await readJsonFile(path))
  if (!parsed.success) {
    throw new Error(`invalid birdgo config: ${parsed.error.message}`)
  }
  const profileEntries = Object.entries(parsed.data.profiles)
  if (profileEntries.length === 0) {
    return undefined
  }
  const timestamp = nowIso()
  const profiles = Object.fromEntries(profileEntries.map(([name, profile]) => [
    name,
    { authToken: profile.authToken, ct0: profile.ct0, createdAt: timestamp, updatedAt: timestamp }
  ]))
  const firstProfileName = profileEntries[0]?.[0] ?? 'default'
  const defaultProfile = parsed.data.defaultProfile && profiles[parsed.data.defaultProfile]
    ? parsed.data.defaultProfile
    : firstProfileName
  return { defaultProfile, profiles, ui: { defaultFeed: 'following', imageRenderer: 'auto' } }
}
