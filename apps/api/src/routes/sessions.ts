import { PatchSessionBody, PatchSetBody, StartSessionBody } from '@workout/shared'
import { body, param, service } from './http.js'
import type { RouteDeps, V1 } from './types.js'

export function registerSessions(v1: V1, { getService }: RouteDeps) {
  v1.get('/sessions', async (c) => c.json(await service(c, getService).listSessions()))
  // Registered before /sessions/:id so "active" is never read as an id.
  v1.get('/sessions/active', async (c) => c.json((await service(c, getService).getActiveSession()) ?? null))
  v1.post('/sessions', async (c) => {
    const { plan_day_id } = await body(c, StartSessionBody)
    return c.json(await service(c, getService).startSession(plan_day_id), 201)
  })
  v1.get('/sessions/:id', async (c) => {
    const found = await service(c, getService).getSession(param(c, 'id'))
    return found ? c.json(found) : c.json({ error: 'not_found' }, 404)
  })
  v1.patch('/sessions/:id', async (c) => {
    const id = param(c, 'id')
    const { note } = await body(c, PatchSessionBody)
    const s = service(c, getService)
    await s.updateSessionNote(id, note)
    const found = await s.getSession(id)
    return found ? c.json(found) : c.json({ error: 'not_found' }, 404)
  })
  v1.delete('/sessions/:id', async (c) => {
    const id = param(c, 'id')
    const s = service(c, getService)
    if (!(await s.owns('session', id))) return c.json({ error: 'not_found' }, 404)
    await s.discardSession(id)
    return c.body(null, 204)
  })
  v1.post('/sessions/:id/complete', async (c) => {
    return c.json(await service(c, getService).finishSession(param(c, 'id')))
  })
  v1.patch('/sets/:id', async (c) => {
    const id = param(c, 'id')
    const patch = await body(c, PatchSetBody)
    return c.json(await service(c, getService).updateSet(id, patch))
  })
}
