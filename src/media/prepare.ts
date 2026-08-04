import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { mediaCacheDir } from '../config/paths.ts'
import { downloadMedia, mediaCachePath } from './cache.ts'

export type ImageShape = 'circle' | 'rect'

export type PrepareRequest = {
  url: string
  shape: ImageShape
  widthPx: number
  heightPx: number
}

export const prepareCacheKey = (req: PrepareRequest): string => {
  return createHash('sha256').update(`${req.url}|${req.shape}|${req.widthPx}x${req.heightPx}`).digest('hex')
}

export const preparedPath = (req: PrepareRequest, root = mediaCacheDir()): string => {
  return join(root, 'prepared', `${prepareCacheKey(req)}.png`)
}

// The kitty protocol only accepts PNG, and a c/r placement stretches whatever it
// gets, so pad to the exact cell rectangle instead of letting the terminal scale.
export const magickArgs = (source: string, target: string, req: PrepareRequest): string[] => {
  const box = `${req.widthPx}x${req.heightPx}`
  const base = [`${source}[0]`, '-auto-orient', '-background', 'none', '-alpha', 'set']
  if (req.shape === 'circle') {
    const radius = Math.min(req.widthPx, req.heightPx) / 2
    const cx = (req.widthPx - 1) / 2
    const cy = (req.heightPx - 1) / 2
    return [
      ...base,
      '-resize', `${box}^`,
      '-gravity', 'center', '-extent', box,
      '(', '-size', box, 'xc:none', '-fill', 'white', '-draw', `circle ${cx},${cy} ${cx},${cy - radius}`, ')',
      '-compose', 'DstIn', '-composite',
      `PNG32:${target}`
    ]
  }
  return [...base, '-resize', box, '-gravity', 'center', '-extent', box, `PNG32:${target}`]
}

const run = async (command: string, args: string[]): Promise<void> => {
  const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] })
  const stderr: Buffer[] = []
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
  const code = await new Promise<number | null>((resolve, reject) => {
    child.on('error', reject)
    child.on('close', resolve)
  })
  if (code !== 0) {
    throw new Error(Buffer.concat(stderr).toString('utf8').trim() || `${command} exited ${code}`)
  }
}

export const prepareImage = async (req: PrepareRequest, root = mediaCacheDir()): Promise<string> => {
  const target = preparedPath(req, root)
  if (existsSync(target)) {
    return target
  }
  const source = mediaCachePath(req.url, root)
  if (!existsSync(source)) {
    await downloadMedia(req.url, { root })
  }
  await mkdir(join(root, 'prepared'), { recursive: true })
  await run('magick', magickArgs(source, target, req))
  return target
}
