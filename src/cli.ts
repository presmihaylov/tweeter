#!/usr/bin/env bun
import { rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { configPath } from './config/paths.ts'
import { ConfigStore, getProfile } from './config/store.ts'
import { runTerminalApp } from './app/terminalApp.ts'
import { TwitterClient } from './twitter/client.ts'
import { runAuthorizeFlow } from './auth/twitterAuthFlow.ts'
import { errorMessage } from './utils/result.ts'

type RunOptions = {
  profile?: string
  resetAuth: boolean
  debugLog?: string
  renderer?: 'auto' | 'chafa' | 'kitty' | 'none'
  setCookieHeader?: string
  checkAuth: boolean
  help: boolean
}

type AuthTwitterOptions = {
  clientId?: string
  profile?: string
  port?: number
  noBrowser: boolean
  help: boolean
}

const runUsage = `tweeter

Usage:
  tweeter [--profile name] [--renderer auto|chafa|kitty|none] [--debug-log path]
  tweeter --check-auth [--profile name]
  tweeter --set-cookie-header 'name=value; ...' [--profile name]
  tweeter --reset-auth
  tweeter auth twitter --client-id <id> [--profile name] [--port N] [--no-browser]

Keys:
  q quit, R refresh, Tab switch feed, j/k select, Enter load replies, r reply
`

const authTwitterUsage = `tweeter auth twitter

Run the X (Twitter) OAuth 2.0 PKCE flow and save access + refresh tokens
to the selected profile. Used by reply / new tweet calls via the official
X v2 API.

Usage:
  tweeter auth twitter --client-id <id> [--profile name] [--port N] [--no-browser]

Flags:
  --client-id   OAuth 2.0 client ID from developer.x.com (required)
  --profile     Profile to attach tokens to (default: tweeter's defaultProfile)
  --port        Local loopback port (default: random free port)
  --no-browser  Don't try to open the browser automatically
`

const parseRunArgs = (argv: string[]): RunOptions => {
  const opts: RunOptions = { resetAuth: false, checkAuth: false, help: false }
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
    if (arg === '--set-cookie-header') {
      opts.setCookieHeader = nextValue(argv, i, arg)
      i += 1
      continue
    }
    throw new Error(`unknown argument: ${arg}`)
  }
  return opts
}

const parseAuthTwitterArgs = (argv: string[]): AuthTwitterOptions => {
  const opts: AuthTwitterOptions = { noBrowser: false, help: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') {
      opts.help = true
      continue
    }
    if (arg === '--client-id') {
      opts.clientId = nextValue(argv, i, arg)
      i += 1
      continue
    }
    if (arg === '--profile') {
      opts.profile = nextValue(argv, i, arg)
      i += 1
      continue
    }
    if (arg === '--port') {
      const value = nextValue(argv, i, arg)
      const parsed = Number.parseInt(value, 10)
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 65535) {
        throw new Error(`invalid port: ${value}`)
      }
      opts.port = parsed
      i += 1
      continue
    }
    if (arg === '--no-browser') {
      opts.noBrowser = true
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

const isRenderer = (value: string): value is NonNullable<RunOptions['renderer']> => {
  return value === 'auto' || value === 'chafa' || value === 'kitty' || value === 'none'
}

const openBrowser = (url: string): void => {
  const platform = process.platform
  const command = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = platform === 'win32' ? ['/c', 'start', '""', url] : [url]
  const child = spawn(command, args, { stdio: 'ignore', detached: true })
  child.unref()
}

const runAuthTwitter = async (argv: string[]): Promise<void> => {
  const opts = parseAuthTwitterArgs(argv)
  if (opts.help) {
    console.log(authTwitterUsage)
    return
  }
  if (!opts.clientId) {
    console.error('--client-id is required (get one from developer.x.com → your app → OAuth 2.0 settings)')
    process.exitCode = 1
    return
  }
  const store = new ConfigStore()
  const config = await store.load()
  const selected = getProfile(config, opts.profile)
  if (!selected) {
    console.error('no profile configured; run `tweeter` once to set up cookies first')
    process.exitCode = 1
    return
  }
  console.log('Starting X OAuth 2.0 PKCE flow...')
  const result = await runAuthorizeFlow({
    clientId: opts.clientId,
    port: opts.port,
    openBrowser: opts.noBrowser ? undefined : openBrowser,
    onUrl: (url) => {
      console.log('')
      console.log('If your browser did not open automatically, visit:')
      console.log(`  ${url}`)
      console.log('')
      console.log('Waiting for callback...')
    }
  })
  if (!result.ok) {
    console.error(`OAuth flow failed: ${result.error}`)
    process.exitCode = 1
    return
  }
  await store.setXApiTokens(selected.name, result.tokens)
  console.log(`Saved X API tokens to profile "${selected.name}" (scope: ${result.tokens.scope ?? 'unknown'})`)
}

const runMainCommand = async (argv: string[]): Promise<void> => {
  const opts = parseRunArgs(argv)
  if (opts.help) {
    console.log(runUsage)
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
  if (opts.setCookieHeader) {
    if (!selected) {
      console.error('no profile configured')
      process.exitCode = 1
      return
    }
    await store.upsertProfile(selected.name, {
      authToken: selected.profile.authToken,
      ct0: selected.profile.ct0,
      cookieHeader: opts.setCookieHeader
    })
    console.log(`saved full cookie header for profile ${selected.name}`)
    return
  }
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
    console.log(status.username ? `ok @${status.username}` : `ok (verified via ${status.source})`)
    return
  }
  await runTerminalApp({ config, profileName: selected?.name, profile: selected?.profile, renderer: opts.renderer, debugLog: opts.debugLog })
}

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2)
  if (argv[0] === 'auth') {
    if (argv[1] === 'twitter') {
      await runAuthTwitter(argv.slice(2))
      return
    }
    console.error(`unknown auth subcommand: ${argv[1] ?? '(none)'}`)
    process.exitCode = 1
    return
  }
  await runMainCommand(argv)
}

main().catch((error: unknown) => {
  console.error(errorMessage(error))
  process.exitCode = 1
})
