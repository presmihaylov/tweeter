import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { importBirdgoConfig } from '../src/config/birdgoImport.ts'
import { ConfigStore, importLegacyConfig } from '../src/config/store.ts'

describe('config', () => {
  test('imports the pre-rename birdtui config', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tweeter-legacy-'))
    const path = join(dir, 'config.json')
    await writeFile(path, JSON.stringify({
      defaultProfile: 'me',
      profiles: { me: { authToken: 'a', ct0: 'c', xApi: { clientId: 'C', accessToken: 'A', refreshToken: 'R', expiresAt: 1 } } }
    }))
    const imported = await importLegacyConfig(path)
    expect(imported?.defaultProfile).toBe('me')
    expect(imported?.profiles.me?.xApi?.accessToken).toBe('A')
  })

  test('skips legacy import when the file is absent', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tweeter-legacy-'))
    expect(await importLegacyConfig(join(dir, 'missing.json'))).toBeUndefined()
  })

  test('imports birdgo profiles', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tweeter-config-'))
    const path = join(dir, 'config.json')
    await writeFile(path, JSON.stringify({ defaultProfile: 'me', profiles: { me: { authToken: 'a', ct0: 'c' } } }))
    const imported = await importBirdgoConfig(path)
    expect(imported?.defaultProfile).toBe('me')
    expect(imported?.profiles.me?.authToken).toBe('a')
  })

  test('saves upserted profile', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tweeter-config-'))
    const path = join(dir, 'config.json')
    const store = new ConfigStore(path)
    await store.upsertProfile('default', { authToken: 'auth', ct0: 'csrf' })
    const raw = JSON.parse(await readFile(path, 'utf8')) as { profiles: Record<string, { ct0: string }> }
    expect(raw.profiles.default?.ct0).toBe('csrf')
  })

  test('preserves and updates full cookie header', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tweeter-config-'))
    const path = join(dir, 'config.json')
    const store = new ConfigStore(path)
    await store.upsertProfile('default', { authToken: 'auth', ct0: 'csrf', cookieHeader: 'auth_token=auth; ct0=csrf; twid=u%3D1' })
    await store.upsertProfile('default', { authToken: 'auth2', ct0: 'csrf2' })
    const raw = JSON.parse(await readFile(path, 'utf8')) as { profiles: Record<string, { cookieHeader?: string }> }
    expect(raw.profiles.default?.cookieHeader).toBe('auth_token=auth; ct0=csrf; twid=u%3D1')
  })

  test('setXApiTokens persists OAuth tokens on the profile', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tweeter-config-'))
    const path = join(dir, 'config.json')
    const store = new ConfigStore(path)
    await store.upsertProfile('default', { authToken: 'auth', ct0: 'csrf' })
    await store.setXApiTokens('default', {
      clientId: 'C',
      accessToken: 'A',
      refreshToken: 'R',
      expiresAt: 1_700_000_000_000,
      scope: 'tweet.write'
    })
    const raw = JSON.parse(await readFile(path, 'utf8')) as { profiles: Record<string, { xApi?: { accessToken: string; refreshToken: string } }> }
    expect(raw.profiles.default?.xApi?.accessToken).toBe('A')
    expect(raw.profiles.default?.xApi?.refreshToken).toBe('R')
  })

  test('setXApiTokens throws when profile is missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tweeter-config-'))
    const path = join(dir, 'config.json')
    const store = new ConfigStore(path)
    await expect(store.setXApiTokens('missing', {
      clientId: 'C', accessToken: 'A', refreshToken: 'R', expiresAt: 1
    })).rejects.toThrow('profile not found')
  })

  test('setSearchTabs keeps the tabs, in order, next to the other ui settings', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tweeter-config-'))
    const path = join(dir, 'config.json')
    const store = new ConfigStore(path)
    await store.upsertProfile('default', { authToken: 'auth', ct0: 'csrf' })
    await store.save({ ...await store.load(), ui: { defaultFeed: 'forYou' } })
    await store.setSearchTabs(['claude code', 'opentui'])
    const raw = JSON.parse(await readFile(path, 'utf8')) as { ui?: { defaultFeed?: string; searchTabs?: string[] } }
    expect(raw.ui?.searchTabs).toEqual(['claude code', 'opentui'])
    expect(raw.ui?.defaultFeed).toBe('forYou')
  })

  test('setSearchTabs with nothing left writes an empty list', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tweeter-config-'))
    const path = join(dir, 'config.json')
    const store = new ConfigStore(path)
    await store.upsertProfile('default', { authToken: 'auth', ct0: 'csrf' })
    await store.setSearchTabs(['claude code'])
    await store.setSearchTabs([])
    expect((await store.load()).ui?.searchTabs).toEqual([])
  })

  test('upsertProfile preserves existing xApi tokens', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tweeter-config-'))
    const path = join(dir, 'config.json')
    const store = new ConfigStore(path)
    await store.upsertProfile('default', { authToken: 'auth', ct0: 'csrf' })
    await store.setXApiTokens('default', { clientId: 'C', accessToken: 'A', refreshToken: 'R', expiresAt: 1 })
    await store.upsertProfile('default', { authToken: 'auth2', ct0: 'csrf2' })
    const raw = JSON.parse(await readFile(path, 'utf8')) as { profiles: Record<string, { xApi?: { accessToken: string } }> }
    expect(raw.profiles.default?.xApi?.accessToken).toBe('A')
  })
})
