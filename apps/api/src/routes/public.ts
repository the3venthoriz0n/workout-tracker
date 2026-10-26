import { Hono, type MiddlewareHandler } from 'hono'
import { IdParam, publicListQuerySchema } from '@workout/shared'
import { z } from 'zod'
import type { PublicService } from '../service/community.js'
import { parse } from './http.js'

export type PublicRateLimit = {
  /** Requests per window per client IP (default 60). */
  max?: number
  windowMs?: number
  /** Headers carrying the client IP, first match wins; none: one shared bucket. */
  ipHeaders: string[]
  enabled: boolean
}
export type PublicDeps = { getPublic: () => PublicService; rateLimit: PublicRateLimit }

/** Fixed-window, in-memory limiter (single API process, like Better Auth's store). */
function rateLimiter({ max = 60, windowMs = 60_000, ipHeaders }: PublicRateLimit): MiddlewareHandler {
  const hits = new Map<string, { start: number; count: number }>()
  return async (c, next) => {
    const now = Date.now()
    if (hits.size > 10_000) for (const [k, v] of hits) if (now - v.start >= windowMs) hits.delete(k)
    let ip = 'shared'
    for (const h of ipHeaders) {
      const v = c.req.header(h)?.split(',')[0]?.trim()
      if (v) {
        ip = v.slice(0, 64)
        break
      }
    }
    const entry = hits.get(ip)
    if (!entry || now - entry.start >= windowMs) hits.set(ip, { start: now, count: 1 })
    else if (++entry.count > max) {
      c.header('Retry-After', String(Math.ceil((entry.start + windowMs - now) / 1000)))
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
