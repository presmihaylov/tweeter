// Headless posting: one JSON object on stdout, an exit code, no TUI. Built for an
// agent that runs `tweeter post` / `tweeter reply` and reads the answer back.
import { statusUrl } from '../twitter/urls.ts'
import type { PostResult } from '../twitter/types.ts'

export type PublishCommand = 'post' | 'reply'

export type PublishOptions = {
  command: PublishCommand
  text?: string
  textFile?: string
  replyTo?: string
  profile?: string
  dryRun: boolean
  help: boolean
}

// Only what publishing needs, so a test hands over two functions instead of a client.
export type Publisher = {
  postTweet: (args: { text: string }) => Promise<PostResult>
  replyToTweet: (args: { tweetId: string; text: string }) => Promise<PostResult>
}

export type PublishOutcome = { exitCode: number; stdout: string }

export class UsageError extends Error {}

export const publishUsage = `tweeter post / tweeter reply

Post or reply without the TUI. Writes one JSON object to stdout.

Usage:
  tweeter post  --text <text> | --text-file <path> [--profile name] [--dry-run]
  tweeter reply --to <tweet-id-or-url> --text <text> | --text-file <path> [--profile name] [--dry-run]

Flags:
  --text        The tweet text. Use --text-file for anything multi-line.
  --text-file   Read the text from a file. "-" reads stdin.
  --to          The tweet to answer: a numeric id, or any x.com status URL.
  --profile     Which saved profile to post from (default: the default profile).
  --dry-run     Report what would be sent and post nothing.

Exit codes:
  0  posted (or dry run)
  1  X refused the write, or auth is missing
  2  the arguments are wrong
`

// Accepts the id on its own or any status URL, because an agent usually has the link.
export const parseTweetRef = (value: string): string | undefined => {
  const trimmed = value.trim()
  if (/^\d+$/.test(trimmed)) {
    return trimmed
  }
  const match = /\/status(?:es)?\/(\d+)/.exec(trimmed)
  return match?.[1]
}

export const parsePublishArgs = (command: PublishCommand, argv: string[]): PublishOptions => {
  const opts: PublishOptions = { command, dryRun: false, help: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') {
      opts.help = true
      continue
    }
    if (arg === '--dry-run') {
      opts.dryRun = true
      continue
    }
    if (arg === '--text') {
      opts.text = nextValue(argv, i, arg)
      i += 1
      continue
    }
    if (arg === '--text-file') {
      opts.textFile = nextValue(argv, i, arg)
      i += 1
      continue
    }
    if (arg === '--to') {
      const ref = parseTweetRef(nextValue(argv, i, arg))
      if (!ref) {
        throw new UsageError('--to needs a numeric tweet id or an x.com status URL')
      }
      opts.replyTo = ref
      i += 1
      continue
    }
    if (arg === '--profile') {
      opts.profile = nextValue(argv, i, arg)
      i += 1
      continue
    }
    throw new UsageError(`unknown argument: ${arg}`)
  }
  if (opts.help) {
    return opts
  }
  if (opts.text !== undefined && opts.textFile !== undefined) {
    throw new UsageError('pass --text or --text-file, not both')
  }
  if (opts.text === undefined && opts.textFile === undefined) {
    throw new UsageError('--text or --text-file is required')
  }
  if (command === 'reply' && !opts.replyTo) {
    throw new UsageError('--to is required for a reply')
  }
  return opts
}

const nextValue = (argv: string[], index: number, flag: string): string => {
  const value = argv[index + 1]
  if (value === undefined || value.startsWith('--')) {
    throw new UsageError(`${flag} requires a value`)
  }
  return value
}

export const runPublish = async (opts: PublishOptions, text: string, publisher: Publisher): Promise<PublishOutcome> => {
  if (text.trim() === '') {
    return failure(2, 'the text is empty')
  }
  if (opts.dryRun) {
    return ok({ command: opts.command, dryRun: true, text, ...replyField(opts) })
  }
  const result = opts.command === 'reply'
    ? await publisher.replyToTweet({ tweetId: opts.replyTo ?? '', text })
    : await publisher.postTweet({ text })
  if (!result.ok) {
    return {
      exitCode: 1,
      stdout: json({
        ok: false,
        command: opts.command,
        error: result.error,
        ...(result.code === undefined ? {} : { code: result.code }),
        ...(result.status === undefined ? {} : { status: result.status })
      })
    }
  }
  return ok({
    command: opts.command,
    tweetId: result.tweetId,
    // x.com ignores the handle segment and redirects, so "i" resolves without
    // one more request to ask who we are.
    url: statusUrl('i', result.tweetId),
    ...replyField(opts)
  })
}

export const failure = (exitCode: number, error: string): PublishOutcome => ({ exitCode, stdout: json({ ok: false, error }) })

const ok = (fields: Record<string, unknown>): PublishOutcome => ({ exitCode: 0, stdout: json({ ok: true, ...fields }) })

const replyField = (opts: PublishOptions): Record<string, string> => (opts.replyTo ? { inReplyTo: opts.replyTo } : {})

const json = (value: unknown): string => JSON.stringify(value)
