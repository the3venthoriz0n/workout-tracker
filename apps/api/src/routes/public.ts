import { Hono, type MiddlewareHandler } from 'hono'
import { IdParam, publicListQuerySchema } from '@workout/shared'
import { z } from 'zod'
import type { PublicService } from '../service/community.js'
import { parse } from './http.js'

export type PublicRateLimit = {
  /** Requests per window per client IP (default 60). */
  max?: number
  windowMs?: number
  /** Headers carrying the client IP, first present wins; none: one shared bucket. */
  ipHeaders: string[]
  enabled: boolean
}
export type PublicDeps = { getPublic: () => PublicService; rateLimit: PublicRateLimit }

const IP = /^[0-9a-fA-F:.]{2,45}$/

/**
 * The client of a proxy header: its RIGHT-most value, the one appended by the nearest trusted
 * proxy (a client can prepend anything to X-Forwarded-For). Undefined unless it looks like an IP.
 */
export function clientKey(value: string | undefined): string | undefined {
  const last = value
    ?.split(',')
    .map((v) => v.trim())
    .filter(Boolean)
    .at(-1)
  return last && IP.test(last) && /[.:]/.test(last) && /[0-9a-fA-F]/.test(last) ? last : undefined
}

export type RateLimitStore = { hit(key: string): { ok: boolean; retryAfterMs: number }; sweep(): void; size(): number }

/**
 * Fixed-window counters in memory (single API process, like Better Auth's store), bounded to
 * `maxKeys`: when full, expired keys are swept (at most once a second on the request path), and
 * new keys that still do not fit share one overflow bucket instead of growing the map. An unref'd
 * timer sweeps every `sweepIntervalMs` (0: none) so the request path stays O(1) normally.
 */
export function createRateLimitStore(opts: {
  max: number
  windowMs: number
  maxKeys?: number
  now?: () => number
  sweepIntervalMs?: number
}): RateLimitStore {
  const { max, windowMs, maxKeys = 10_000, now = Date.now, sweepIntervalMs = windowMs } = opts
  const hits = new Map<string, { start: number; count: number }>()
  let lastSweep = -Infinity
  const sweep = () => {
    const t = now()
    lastSweep = t
    for (const [k, v] of hits) if (t - v.start >= windowMs) hits.delete(k)
  }
  if (sweepIntervalMs > 0) setInterval(sweep, sweepIntervalMs).unref?.()
  return {
    sweep,
    size: () => hits.size,
    hit(key) {
      const t = now()
      if (!hits.has(key) && hits.size >= maxKeys) {
        if (t - lastSweep >= 1000) sweep()
        if (hits.size >= maxKeys) key = 'overflow'
      }
      const entry = hits.get(key)
      if (!entry || t - entry.start >= windowMs) {
        hits.set(key, { start: t, count: 1 })
        return { ok: true, retryAfterMs: 0 }
      }
      if (++entry.count > max) return { ok: false, retryAfterMs: entry.start + windowMs - t }
      return { ok: true, retryAfterMs: 0 }
    },
  }
}

function rateLimiter({ max = 60, windowMs = 60_000, ipHeaders }: PublicRateLimit): MiddlewareHandler {
  const store = createRateLimitStore({ max, windowMs })
  return async (c, next) => {
    let key = 'shared'
    for (const h of ipHeaders) {
      const v = c.req.header(h)
      if (v !== undefined) {
        key = clientKey(v) ?? 'shared'
        break
      }
    }
    const r = store.hit(key)
    if (!r.ok) {
      c.header('Retry-After', String(Math.ceil(r.retryAfterMs / 1000)))
      return c.json({ error: 'rate_limited' }, 429)
    }
    return next()
  }
}

const VersionParam = z.coerce.number().int().min(1).max(1_000_000)

/**
 * The public community area under /api/public (spec §9): GET only, no session is ever read, and
 * every response is cacheable for 30 s. Rate limited per client IP (60 a minute by default). Responses carry only the whitelisted public fields.
 */
export function createPublicApp({ getPublic, rateLimit }: PublicDeps): Hono {
  const pub = new Hono()
  if (rateLimit.enabled) pub.use('*', rateLimiter(rateLimit))
  pub.use('*', async (c, next) => {
    await next()
    c.header('Cache-Control', 'public, max-age=30')
  })
  pub.get('/plans', async (c) => {
    const query = parse(publicListQuerySchema, c.req.query())
    return c.json(await getPublic().listPlans(query))
  })
  pub.get('/plans/:id', async (c) => {
    const id = parse(IdParam, c.req.param('id'), ['id'])
    const found = await getPublic().getPlan(id)
    return found ? c.json(found) : c.json({ error: 'not_found' }, 404)
  })
  pub.get('/plans/:id/versions/:n', async (c) => {
    const id = parse(IdParam, c.req.param('id'), ['id'])
    const n = parse(VersionParam, c.req.param('n'), ['n'])
    const found = await getPublic().getPlan(id, n)
    return found ? c.json(found) : c.json({ error: 'not_found' }, 404)
  })
  return pub
}
