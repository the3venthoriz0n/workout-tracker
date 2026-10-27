import { AdoptBody, PublishBody } from '@workout/shared'
import { body, param, service } from './http.js'
import type { RouteDeps, V1 } from './types.js'

/** Authenticated community routes (spec §9). The public reads live in public.ts. */
export function registerCommunity(v1: V1, { getService }: RouteDeps) {
  v1.post('/plans/:id/publish', async (c) => {
    const id = param(c, 'id')
    const meta = await body(c, PublishBody)
    return c.json(await service(c, getService).publishPlan(id, meta))
  })
  v1.delete('/plans/:id/publish', async (c) => {
    await service(c, getService).unpublishPlan(param(c, 'id'))
    return c.body(null, 204)
  })
  v1.get('/shared-plans/mine', async (c) => c.json(await service(c, getService).listMyShared()))
  v1.get('/shared-plans/:id/vote', async (c) => {
    const voted = await service(c, getService).hasVoted(param(c, 'id'))
    return c.json({ voted })
  })
  v1.put('/shared-plans/:id/vote', async (c) => c.json(await service(c, getService).setVote(param(c, 'id'), true)))
  v1.delete('/shared-plans/:id/vote', async (c) => c.json(await service(c, getService).setVote(param(c, 'id'), false)))
  v1.post('/shared-plans/:id/adopt', async (c) => {
    const id = param(c, 'id')
    // Only the version is read from the body: the snapshot always comes from the database.
    const { version } = await body(c, AdoptBody)
    const input = version === undefined ? { shared_plan_id: id } : { shared_plan_id: id, version }
    return c.json(await service(c, getService).adoptSharedPlan(input), 201)
  })
}
