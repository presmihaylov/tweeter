import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { cacheDir } from '../config/paths.ts'

export type DebugLogger = {
  readonly path: string
  log(event: string, data?: Record<string, unknown>): Promise<void>
}

export const defaultDebugLogPath = (): string => `${cacheDir()}/debug.log`

export const createDebugLogger = (path = defaultDebugLogPath()): DebugLogger => ({
  path,
  async log(event, data = {}) {
    await mkdir(dirname(path), { recursive: true })
    const redacted = redact(data)
    const payload = typeof redacted === 'object' && redacted !== null && !Array.isArray(redacted) ? redacted : {}
    const line = JSON.stringify({ ts: new Date().toISOString(), event, ...payload })
    await appendFile(path, `${line}\n`, 'utf8')
  }
})

export const safeJsonSnippet = (value: unknown, maxLength = 1200): string => {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  if (text.length <= maxLength) {
    return text
  }
  return `${text.slice(0, maxLength)}…`
}

const redact = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(redact)
  }
  if (typeof value !== 'object' || value === null) {
    return value
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (/auth|token|ct0|cookie|csrf/i.test(key)) {
      return [key, '<redacted>']
    }
    return [key, redact(item)]
  }))
}
