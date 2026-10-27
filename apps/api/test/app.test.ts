import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { cookieJar, setupApp, type Harness } from './helpers.js'

let h: Harness
afterEach(async () => {
  await h?.cleanup()
})

describe('app', () => {
  it('returns JSON 404 for unknown API routes (once signed in)', async () => {
    h = await setupApp()
    const jar = cookieJar(await h.signUpVerified('a@example.com'))
    const res = await h.request('/api/v1/nope', { cookie: jar })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not_found' })
    const other = await h.request('/api/nope')
    expect(other.status).toBe(404)
    expect(await other.json()).toEqual({ error: 'not_found' })
  })

  it('sets security headers on every kind of response', async () => {
    h = await setupApp()
    for (const path of ['/api/nope', '/api/v1/_whoami', '/healthz']) {
      const res = await h.request(path)
      expect(res.headers.get('content-security-policy'), path).toContain("default-src 'self'")
      expect(res.headers.get('x-content-type-options'), path).toBe('nosniff')
      expect(res.headers.get('strict-transport-security'), path).toBe('max-age=15552000')
    }
    const denied = await h.request('/api/v1/x', { method: 'POST', body: {}, origin: null })
    expect(denied.status).toBe(403)
    expect(denied.headers.get('content-security-policy')).toContain("default-src 'self'")
  })

  it('keeps /healthz public and reports a failing database as 503', async () => {
    h = await setupApp()
    const ok = await h.request('/healthz')
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ ok: true })
    const down = createApp({
      auth: h.auth,
      env: h.env,
      getService: () => {
        throw new Error('unused')
      },
      getPublic: () => {
        throw new Error('unused')
      },
      sqlHealth: async () => false,
    })
    const res = await down.request('/healthz')
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ ok: false })
  })

  it('enforces the 1 MB body limit on /api/*', async () => {
    h = await setupApp()
    const res = await h.request('/api/v1/x', {
      method: 'POST',
      rawBody: JSON.stringify({ pad: 'x'.repeat(1024 * 1024 + 10) }),
    })
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: 'payload_too_large' })
  })

  it('hides internal errors', async () => {
    h = await setupApp()
    const boom = createApp({
      auth: {
        handler: async () => {
          throw new Error('secret detail')
        },
        api: {},
      } as never,
      env: h.env,
      getService: () => {
        throw new Error('unused')
      },
      getPublic: () => {
        throw new Error('unused')
      },
    })
    const res = await boom.request('/api/auth/ok', { headers: {} })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'internal_error' })
  })
})
