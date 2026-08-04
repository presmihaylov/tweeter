import { describe, expect, test } from 'bun:test'
import { startLoopbackServer } from '../src/twitter/oauth/loopback.ts'

describe('startLoopbackServer', () => {
  test('captures code+state on /callback and serves a success page', async () => {
    const handle = await startLoopbackServer('/callback', 0)
    try {
      expect(handle.port).toBeGreaterThan(0)
      expect(handle.redirectUri).toContain(`127.0.0.1:${handle.port}/callback`)
      const callbackPromise = handle.waitForCallback()
      const response = await fetch(`${handle.redirectUri}?code=ABC&state=XYZ`)
      expect(response.status).toBe(200)
      const html = await response.text()
      expect(html).toContain('tweeter connected')
      const callback = await callbackPromise
      expect(callback.ok).toBe(true)
      if (callback.ok) {
        expect(callback.code).toBe('ABC')
        expect(callback.state).toBe('XYZ')
      }
    } finally {
      await handle.close()
    }
  })

  test('reports OAuth errors from the redirect', async () => {
    const handle = await startLoopbackServer('/callback', 0)
    try {
      const callbackPromise = handle.waitForCallback()
      const response = await fetch(`${handle.redirectUri}?error=access_denied`)
      expect(response.status).toBe(400)
      const callback = await callbackPromise
      expect(callback.ok).toBe(false)
      if (!callback.ok) {
        expect(callback.error).toBe('access_denied')
      }
    } finally {
      await handle.close()
    }
  })

  test('returns 404 for unrelated paths', async () => {
    const handle = await startLoopbackServer('/callback', 0)
    try {
      const response = await fetch(`http://127.0.0.1:${handle.port}/other`)
      expect(response.status).toBe(404)
    } finally {
      await handle.close()
    }
  })
})
