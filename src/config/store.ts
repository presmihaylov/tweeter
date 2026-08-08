import { existsSync } from 'node:fs'
import type { TweeterConfig, TweeterProfile, XApiTokens } from './schema.ts'
import { tweeterConfigSchema, emptyConfig } from './schema.ts'
import { configPath, legacyConfigPath } from './paths.ts'
import { importBirdgoConfig } from './birdgoImport.ts'
import { readJsonFile, writeJsonFile } from '../utils/fs.ts'
import { nowIso } from '../utils/time.ts'

export const importLegacyConfig = async (path = legacyConfigPath()): Promise<TweeterConfig | undefined> => {
  if (!existsSync(path)) {
    return undefined
  }
  const parsed = tweeterConfigSchema.safeParse(await readJsonFile(path))
  if (!parsed.success) {
    return undefined
  }
  return parsed.data
}

export class ConfigStore {
  constructor(private readonly path = configPath()) {}

  async load(): Promise<TweeterConfig> {
    if (!existsSync(this.path)) {
      const imported = await importLegacyConfig() ?? await importBirdgoConfig()
      if (imported) {
        await this.save(imported)
        return imported
      }
      return emptyConfig()
    }
    const parsed = tweeterConfigSchema.safeParse(await readJsonFile(this.path))
    if (!parsed.success) {
      throw new Error(`invalid tweeter config: ${parsed.error.message}`)
    }
    return parsed.data
  }

  async save(config: TweeterConfig): Promise<void> {
    const parsed = tweeterConfigSchema.parse(config)
    await writeJsonFile(this.path, parsed)
  }

  async upsertProfile(name: string, profile: Pick<TweeterProfile, 'authToken' | 'ct0'> & Pick<Partial<TweeterProfile>, 'cookieHeader'>): Promise<TweeterConfig> {
    const cfg = await this.load()
    const existing = cfg.profiles[name]
    const timestamp = nowIso()
    const nextProfile: TweeterProfile = {
      authToken: profile.authToken,
      ct0: profile.ct0,
      cookieHeader: profile.cookieHeader ?? existing?.cookieHeader,
      xApi: existing?.xApi,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    }
    const next: TweeterConfig = {
      ...cfg,
      defaultProfile: cfg.defaultProfile && cfg.profiles[cfg.defaultProfile] ? cfg.defaultProfile : name,
      profiles: { ...cfg.profiles, [name]: nextProfile }
    }
    await this.save(next)
    return next
  }

  // The whole list every time, because adding and closing a tab both end here and the order
  // on the rail is the order in the file.
  async setSearchTabs(queries: string[]): Promise<TweeterConfig> {
    const cfg = await this.load()
    const next: TweeterConfig = { ...cfg, ui: { ...cfg.ui, searchTabs: queries } }
    await this.save(next)
    return next
  }

  async setXApiTokens(name: string, tokens: XApiTokens): Promise<TweeterConfig> {
    const cfg = await this.load()
    const existing = cfg.profiles[name]
    if (!existing) {
      throw new Error(`profile not found: ${name}`)
    }
    const nextProfile: TweeterProfile = {
      ...existing,
      xApi: tokens,
      updatedAt: nowIso()
    }
    const next: TweeterConfig = {
      ...cfg,
      profiles: { ...cfg.profiles, [name]: nextProfile }
    }
    await this.save(next)
    return next
  }
}

export const getProfile = (config: TweeterConfig, requested?: string): { name: string; profile: TweeterProfile } | undefined => {
  const name = requested ?? config.defaultProfile
  const profile = config.profiles[name]
  if (!profile) {
    return undefined
  }
  return { name, profile }
}
