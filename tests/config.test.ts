import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { importBirdgoConfig } from '../src/config/birdgoImport.ts'
import { ConfigStore } from '../src/config/store.ts'

describe('config', () => {
  test('imports birdgo profiles', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'birdtui-config-'))
    const path = join(dir, 'config.json')
    await writeFile(path, JSON.stringify({ defaultProfile: 'me', profiles: { me: { authToken: 'a', ct0: 'c' } } }))
    const imported = await importBirdgoConfig(path)
    expect(imported?.defaultProfile).toBe('me')
    expect(imported?.profiles.me?.authToken).toBe('a')
  })

  test('saves upserted profile', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'birdtui-config-'))
    const path = join(dir, 'config.json')
    const store = new ConfigStore(path)
    await store.upsertProfile('default', { authToken: 'auth', ct0: 'csrf' })
    const raw = JSON.parse(await readFile(path, 'utf8')) as { profiles: Record<string, { ct0: string }> }
    expect(raw.profiles.default?.ct0).toBe('csrf')
  })
})
