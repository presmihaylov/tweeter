import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

export type CallbackResult =
  | { ok: true; code: string; state: string }
  | { ok: false; error: string }

export type LoopbackHandle = {
  redirectUri: string
  port: number
  waitForCallback: () => Promise<CallbackResult>
  close: () => Promise<void>
}

export const startLoopbackServer = async (path = '/callback', preferredPort = 0): Promise<LoopbackHandle> => {
  let resolveCallback: (value: CallbackResult) => void = () => {}
  const callbackPromise = new Promise<CallbackResult>((resolve) => {
    resolveCallback = resolve
  })

  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    const url = new URL(req.url ?? '/', `http://localhost`)
    if (url.pathname !== path) {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('not found')
      return
    }
    const error = url.searchParams.get('error')
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    if (error !== null) {
      res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' })
      res.end(renderResultPage('Authorization failed', `X returned: ${escapeHtml(error)}. You can close this tab.`))
      resolveCallback({ ok: false, error })
      return
    }
    if (code === null || state === null) {
      res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' })
      res.end(renderResultPage('Invalid callback', 'Missing code or state.'))
      resolveCallback({ ok: false, error: 'missing code or state in callback' })
      return
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(renderResultPage('birdtui connected', 'You can close this tab and return to the terminal.'))
    resolveCallback({ ok: true, code, state })
  }

  const server: Server = createServer(handler)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(preferredPort, '127.0.0.1', () => resolve())
  })
  const address = server.address() as AddressInfo
  const port = address.port

  return {
    port,
    redirectUri: `http://127.0.0.1:${port}${path}`,
    waitForCallback: () => callbackPromise,
    close: () => new Promise((resolve) => server.close(() => resolve()))
  }
}

const renderResultPage = (title: string, body: string): string => {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font-family:system-ui,sans-serif;background:#0d1117;color:#f0f6fc;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}div{max-width:480px;text-align:center;padding:2rem;}h1{font-weight:500;}p{color:#8b949e;}</style></head><body><div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p></div></body></html>`
}

const escapeHtml = (value: string): string => {
  return value.replace(/[&<>"']/gu, (ch) => {
    switch (ch) {
      case '&': return '&amp;'
      case '<': return '&lt;'
      case '>': return '&gt;'
      case '"': return '&quot;'
      default: return '&#39;'
    }
  })
}
