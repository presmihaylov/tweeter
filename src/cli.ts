#!/usr/bin/env bun
import { rm } from 'node:fs/promises'
import { configPath } from './config/paths.ts'
import { ConfigStore, getProfile } from './config/store.ts'
import { runTerminalApp } from './app/terminalApp.ts'
import { TwitterClient } from './twitter/client.ts'
import { errorMessage } from './utils/result.ts'

type CliOptions = {
  profile?: string
  resetAuth: boolean
  debugLog?: string
  renderer?: 'auto' | 'chafa' | 'kitty' | 'none'
  checkAuth: boolean
  help: boolean
}

const parseArgs = (argv: string[]): CliOptions => {
  const opts: CliOptions = { resetAuth: false, checkAuth: false, help: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') {
      opts.help = true
      continue
    }
    if (arg === '--reset-auth') {
      opts.resetAuth = true
      continue
    }
    if (arg === '--check-auth') {
      opts.checkAuth = true
      continue
    }
    if (arg === '--profile') {
      opts.profile = nextValue(argv, i, arg)
      i += 1
      continue
    }
    if (arg === '--debug-log') {
      opts.debugLog = nextValue(argv, i, arg)
      i += 1
      continue
    }
    if (arg === '--renderer') {
      const value = nextValue(argv, i, arg)
      if (!isRenderer(value)) {
        throw new Error(`invalid renderer: ${value}`)
      }
      opts.renderer = value
      i += 1
      continue
    }
    throw new Error(`unknown argument: ${arg}`)
  }
  return opts
}

const nextValue = (argv: string[], index: number, flag: string): string => {
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`)
  }
  return value
}

const isRenderer = (value: string): value is NonNullable<CliOptions['renderer']> => {
  return value === 'auto' || value === 'chafa' || value === 'kitty' || value === 'none'
}

const usage = `birdtui

Usage:
  bird [--profile name] [--renderer auto|chafa|kitty|none] [--debug-log path]
  bird --check-auth [--profile name]
  bird --reset-auth

Keys:
  q quit, R refresh, Tab switch feed, j/k select, Enter load replies, r reply
`

const main = async (): Promise<void> => {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) {
    console.log(usage)
    return
  }
  if (opts.resetAuth) {
    await rm(configPath(), { force: true })
    console.log(`removed ${configPath()}`)
    return
  }
  const store = new ConfigStore()
  const config = await store.load()
  const selected = getProfile(config, opts.profile)
  if (opts.checkAuth) {
    if (!selected) {
      console.error('no profile configured')
      process.exitCode = 1
      return
    }
    const client = new TwitterClient({ authToken: selected.profile.authToken, ct0: selected.profile.ct0 })
    const status = await client.checkAuth()
    if (!status.ok) {
      console.error(status.error)
      process.exitCode = 1
      return
    }
    console.log(`ok @${status.username}`)
    return
  }
  await runTerminalApp({ config, profileName: selected?.name, profile: selected?.profile, renderer: opts.renderer, debugLog: opts.debugLog })
}

main().catch((error: unknown) => {
  console.error(errorMessage(error))
  process.exitCode = 1
})
