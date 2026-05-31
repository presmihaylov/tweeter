import { existsSync } from 'node:fs'
import type { BirdTuiConfig, BirdTuiProfile } from './schema.ts'
import { birdTuiConfigSchema, emptyConfig } from './schema.ts'
import { configPath } from './paths.ts'
import { importBirdgoConfig } from './birdgoImport.ts'
import { readJsonFile, writeJsonFile } from '../utils/fs.ts'
import { nowIso } from '../utils/time.ts'

export class ConfigStore {
  constructor(private readonly path = configPath()) {}

  async load(): Promise<BirdTuiConfig> {
    if (!existsSync(this.path)) {
      const imported = await importBirdgoConfig()
      if (imported) {
        await this.save(imported)
        return imported
      }
      return emptyConfig()
    }
    const parsed = birdTuiConfigSchema.safeParse(await readJsonFile(this.path))
    if (!parsed.success) {
      throw new Error(`invalid birdtui config: ${parsed.error.message}`)
    }
    return parsed.data
  }

  async save(config: BirdTuiConfig): Promise<void> {
    const parsed = birdTuiConfigSchema.parse(config)
    await writeJsonFile(this.path, parsed)
  }

  async upsertProfile(name: string, profile: Pick<BirdTuiProfile, 'authToken' | 'ct0'>): Promise<BirdTuiConfig> {
    const cfg = await this.load()
    const existing = cfg.profiles[name]
    const timestamp = nowIso()
    const nextProfile: BirdTuiProfile = {
      authToken: profile.authToken,
      ct0: profile.ct0,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    }
    const next: BirdTuiConfig = {
      ...cfg,
      defaultProfile: cfg.defaultProfile && cfg.profiles[cfg.defaultProfile] ? cfg.defaultProfile : name,
      profiles: { ...cfg.profiles, [name]: nextProfile }
    }
    await this.save(next)
    return next
  }
}

export const getProfile = (config: BirdTuiConfig, requested?: string): { name: string; profile: BirdTuiProfile } | undefined => {
  const name = requested ?? config.defaultProfile
  const profile = config.profiles[name]
  if (!profile) {
    return undefined
  }
  return { name, profile }
}
