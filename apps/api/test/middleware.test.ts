import { sql } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { cookieJar, setupApp, type Harness } from './helpers.js'

let h: Harness
afterEach(async () => {
  await h?.cleanup()
})

describe('csrfGuard', () => {
  it('rejects every state-changing request without an Origin (403 forbidden_origin)', async () => {
    h = await setupApp()
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      for (const path of ['/api/v1/anything', '/api/auth/sign-in/email', '/api/auth/sign-out', '/api/nope']) {
        const res = await h.request(path, { method, body: {}, origin: null })
        expect(res.status, `${method} ${path}`).toBe(403)
        expect(await res.json()).toEqual({ error: 'forbidden_origin' })
      }
    }
  })

  it('rejects a foreign, null, look-alike or malformed Origin', async () => {
    h = await setupApp()
    for (const origin of [
      'https://evil.example',
      'null',
      'http://localhost:3000.evil.example',
      'http://localhost:3000/',
      'http://localhost@evil.example',
      'HTTP://LOCALHOST:3000',
      '',
    ]) {
      const res = await h.request('/api/auth/sign-in/email', {
        method: 'POST',
        body: { email: 'a@b.co', password: 'x' },
        origin,
      })
      expect(res.status, origin).toBe(403)
      expect(await res.json()).toEqual({ error: 'forbidden_origin' })
    }
  })

  it('checks the origin before the content type', async () => {
    h = await setupApp()
    const res = await h.request('/api/v1/x', {
      method: 'POST',
      rawBody: 'a=b',
      contentType: 'text/plain',
      origin: 'https://evil.example',
    })
    expect(res.status).toBe(403)
  })

  it('rejects a trusted origin with a non-JSON content type (415)', async () => {
    h = await setupApp()
    for (const contentType of [
      'text/plain',
      'application/x-www-form-urlencoded',
      'multipart/form-data; boundary=x',
      'application/jsonx',
      'text/json',
      'application/json-patch+json',
      null, // none at all
    ]) {
      for (const path of ['/api/auth/sign-in/email', '/api/v1/x']) {
        const res = await h.request(path, {
          method: 'POST',
          rawBody: JSON.stringify({ email: 'a@b.co', password: 'x' }),
          contentType,
        })
        expect(res.status, `${contentType} ${path}`).toBe(415)
        expect(await res.json()).toEqual({ error: 'unsupported_media_type' })
      }
    }
  })

  it('accepts application/json with parameters and any letter case', async () => {
    h = await setupApp()
    for (const contentType of ['application/json', 'application/json; charset=utf-8', 'Application/JSON']) {
      const res = await h.request('/api/v1/x', { method: 'POST', body: {}, contentType })
      expect(res.status, contentType).not.toBe(415)
      expect(res.status).not.toBe(403)
    }
  })

  it('has no content-type exception: sign-out must send JSON too', async () => {
    h = await setupApp()
    const noType = await h.request('/api/auth/sign-out', { method: 'POST', contentType: null })
    expect(noType.status).toBe(415)
    const ok = await h.request('/api/auth/sign-out', { method: 'POST', body: {} })
    expect(ok.status).toBe(200)
  })

  it('guards OPTIONS like any other method', async () => {
    h = await setupApp()
    const bare = await h.request('/api/nope', { method: 'OPTIONS', origin: null, contentType: null })
    expect(bare.status).toBe(403)
    const foreign = await h.request('/api/nope', { method: 'OPTIONS', origin: 'https://evil.example', contentType: null })
    expect(foreign.status).toBe(403)
    const trusted = await h.request('/api/nope', { method: 'OPTIONS', body: {} })
    expect(trusted.status).toBe(404)
  })

  it('lets GET and HEAD through without an Origin', async () => {
    h = await setupApp()
    for (const method of ['GET', 'HEAD']) {
      const res = await h.request('/api/v1/nope', { method, origin: null })
      expect([403, 415], method).not.toContain(res.status)
    }
    const ok = await h.request('/api/auth/ok', { origin: null })
    expect(ok.status).toBe(200)
  })

  it('applies to unknown /api paths too', async () => {
    h = await setupApp()
    const res = await h.request('/api/nope', { method: 'POST', body: {}, origin: null })
    expect(res.status).toBe(403)
  })
})

describe('requireUser', () => {
  it('401 unauthorized without a cookie, with the same body for every failure', async () => {
    h = await setupApp()
    const res = await h.request('/api/v1/_whoami')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthorized' })
  })

  it('401 for unknown /api/v1 paths without a cookie (does not reveal which routes exist)', async () => {
    h = await setupApp()
    const res = await h.request('/api/v1/definitely-not-a-route')
    expect(res.status).toBe(401)
  })

  it('401 with a garbage, truncated or tampered cookie', async () => {
    h = await setupApp()
    const up = await h.signUp('a@example.com')
    expect(up.status).toBe(200)
    const jar = cookieJar(up)
    const [name, value] = jar.split('=') as [string, string]
    const flipped = value.slice(0, -3) + (value.endsWith('AAA') ? 'BBB' : 'AAA')
    for (const cookie of [
      `${name}=garbage`,
      `${name}=`,
      `${name}=${value.slice(0, 10)}`,
      `${name}=${flipped}`,
      `${name}=${value.split('.')[0]}`, // token without signature
      `${name}=${value.split('.')[0]}.${'A'.repeat(44)}`,
    ]) {
      const res = await h.request('/api/v1/_whoami', { cookie })
      expect(res.status, cookie).toBe(401)
      expect(await res.json()).toEqual({ error: 'unauthorized' })
    }
  })

  it('401 once the session has expired in the database', async () => {
    h = await setupApp()
    const up = await h.signUp('a@example.com')
    const jar = cookieJar(up)
    expect((await h.request('/api/v1/_whoami', { cookie: jar })).status).toBe(200)
    await h.db.execute(sql`update session set expires_at = now() - interval '1 minute'`)
    const res = await h.request('/api/v1/_whoami', { cookie: jar })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthorized' })
  })

  it('returns the user id and keeps /healthz public', async () => {
    h = await setupApp()
    const up = await h.signUp('a@example.com')
    const id = ((await up.json()) as { user: { id: string } }).user.id
    const who = await h.request('/api/v1/_whoami', { cookie: cookieJar(up) })
    expect(who.status).toBe(200)
    expect(await who.json()).toEqual({ userId: id })
    expect((await h.request('/healthz')).status).toBe(200)
  })
})
