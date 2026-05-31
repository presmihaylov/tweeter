import { homedir } from 'node:os'
import { join } from 'node:path'

const envOr = (name: string, fallback: string): string => {
  const value = process.env[name]
  if (value && value.trim() !== '') {
    return value
  }
  return fallback
}

export const configDir = (): string => envOr('BIRDTUI_CONFIG_DIR', join(homedir(), '.config', 'birdtui'))
export const cacheDir = (): string => envOr('BIRDTUI_CACHE_DIR', join(homedir(), '.cache', 'birdtui'))
export const configPath = (): string => join(configDir(), 'config.json')
export const queryIdsPath = (): string => join(cacheDir(), 'queryids.json')
export const mediaCacheDir = (): string => join(cacheDir(), 'media')
export const birdgoConfigPath = (): string => join(homedir(), '.config', 'birdgo', 'config.json')
