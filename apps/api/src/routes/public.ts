import { Hono } from 'hono'
import { IdParam, publicListQuerySchema } from '@workout/shared'
import { z } from 'zod'
import type { PublicService } from '../service/community.js'
import { parse } from './http.js'

export type PublicDeps = { getPublic: () => PublicService }

const VersionParam = z.coerce.number().int().min(1).max(1_000_000)

/**
 * The public community area under /api/public (spec §9): GET only, no session is ever read, and
 * every response is cacheable for 30 s. Responses carry only the whitelisted public fields.
 */
export function createPublicApp({ getPublic }: PublicDeps): Hono {
  const pub = new Hono()
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
