import { homedir } from 'node:os'
import { join } from 'node:path'

const envOr = (name: string, fallback: string): string => {
  const value = process.env[name]
  if (value && value.trim() !== '') {
    return value
  }
  return fallback
}

export const configDir = (): string => envOr('TWEETER_CONFIG_DIR', join(homedir(), '.config', 'tweeter'))
export const cacheDir = (): string => envOr('TWEETER_CACHE_DIR', join(homedir(), '.cache', 'tweeter'))
export const configPath = (): string => join(configDir(), 'config.json')
export const queryIdsPath = (): string => join(cacheDir(), 'queryids.json')
export const mediaCacheDir = (): string => join(cacheDir(), 'media')
export const birdgoConfigPath = (): string => join(homedir(), '.config', 'birdgo', 'config.json')

// Pre-rename location; read once so existing cookies and X API tokens survive.
export const legacyConfigPath = (): string => join(homedir(), '.config', 'birdtui', 'config.json')
