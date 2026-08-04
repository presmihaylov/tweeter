import { spawn } from 'node:child_process'
import type { AppTweet } from '../twitter/types.ts'

// x.com ignores the handle segment and redirects to the canonical one, so a stale
// or missing handle still resolves.
export const tweetUrl = (tweet: AppTweet): string =>
  `https://x.com/${tweet.author.handle || 'i'}/status/${tweet.id}`

export const openExternal = (url: string): void => {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  spawn(command, args, { detached: true, stdio: 'ignore' }).unref()
}

export const copyToClipboard = async (value: string): Promise<void> => {
  const command = process.platform === 'darwin' ? 'pbcopy' : process.platform === 'win32' ? 'clip' : 'wl-copy'
  const child = spawn(command, [], { stdio: ['pipe', 'ignore', 'ignore'] })
  child.stdin.end(value)
  const code = await new Promise<number | null>((resolve, reject) => {
    child.on('error', reject)
    child.on('close', resolve)
  })
  if (code !== 0) {
    throw new Error(`${command} failed`)
  }
}
