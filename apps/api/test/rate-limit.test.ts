// The public area's limiter: which header value is the client, and the bound on its memory.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { clientKey, createRateLimitStore } from '../src/routes/public.js'
import { createPublicService } from '../src/service/community.js'
import { createService } from '../src/service/index.js'
import { setupApp, type Harness } from './helpers.js'

let h: Harness
beforeAll(async () => {
  h = await setupApp()
})
afterAll(async () => {
  await h?.cleanup()
})

describe('clientKey', () => {
  it('takes the right-most value (the one the nearest proxy appended) and only if it looks like an IP', () => {
    expect(clientKey('1.1.1.1, 2.2.2.2')).toBe('2.2.2.2')
    expect(clientKey('2.2.2.2')).toBe('2.2.2.2')
    expect(clientKey(' 2001:db8::1 ')).toBe('2001:db8::1')
    expect(clientKey('1.1.1.1, ')).toBe('1.1.1.1')
    for (const bad of [undefined, '', 'evil', '1.1.1.1, <script>', 'x'.repeat(46), '1.1.1.1, 2.2.2.2 3.3.3.3', '...']) {
      expect(clientKey(bad), String(bad)).toBeUndefined()
    }
  })
})

describe('createRateLimitStore', () => {
  it('never holds more than maxKeys keys: new keys share one overflow bucket until expired ones are swept', () => {
    let now = 0
    const store = createRateLimitStore({ max: 2, windowMs: 1000, maxKeys: 100, now: () => now, sweepIntervalMs: 0 })
    for (let i = 0; i < 100; i++) expect(store.hit(`10.0.0.${i}`).ok).toBe(true)
    expect(store.size()).toBe(100)
    // Over the bound: 500 new addresses all land in the overflow bucket (limit 2 shared).
    const results = Array.from({ length: 500 }, (_, i) => store.hit(`10.1.${i >> 8}.${i & 255}`).ok)
    expect(results.filter(Boolean)).toHaveLength(2)
    expect(store.size()).toBeLessThanOrEqual(101)
    // Known keys keep their own buckets.
    expect(store.hit('10.0.0.1').ok).toBe(true)
    expect(store.hit('10.0.0.1').ok).toBe(false)
    // Once the window passed, expired keys are swept and new keys get their own bucket again.
    now = 5000
    expect(store.hit('10.2.0.1').ok).toBe(true)
    expect(store.hit('10.2.0.1').ok).toBe(true)
    expect(store.hit('10.2.0.1').ok).toBe(false)
    expect(store.size()).toBeLessThanOrEqual(101)
  })

  it('the periodic sweep drops expired keys', () => {
    let now = 0
    const store = createRateLimitStore({ max: 2, windowMs: 1000, maxKeys: 100, now: () => now, sweepIntervalMs: 0 })
    for (let i = 0; i < 50; i++) store.hit(`10.0.0.${i}`)
    now = 2000
    store.sweep()
    expect(store.size()).toBe(0)
  })
})

describe('public rate limit behind a proxy', () => {
  it('keys on the right-most X-Forwarded-For value; rotating the left-most one does not reset the limit', async () => {
    const app = createApp({
      auth: h.auth,
      env: { ...h.env, NODE_ENV: 'production' } as typeof h.env,
      getService: (u) => createService(h.db, u),
      getPublic: () => createPublicService(h.db),
      publicRateLimit: { max: 3 },
    })
    const hit = (xff: string) => app.request('/api/public/plans', { headers: { 'x-forwarded-for': xff } })
    for (let i = 0; i < 3; i++) expect((await hit(`9.9.9.${i}, 2.2.2.2`)).status).toBe(200)
    expect((await hit('8.8.8.8, 2.2.2.2')).status).toBe(429)
    expect((await hit('2.2.2.2')).status).toBe(429)
    expect((await hit('2.2.2.2, 3.3.3.3')).status).toBe(200)
  })
})
