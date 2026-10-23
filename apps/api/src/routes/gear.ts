import { PutGearBody } from '@workout/shared'
import { body, param, service } from './http.js'
import type { RouteDeps, V1 } from './types.js'

export function registerGear(v1: V1, { getService }: RouteDeps) {
  v1.get('/gear', async (c) => c.json(await service(c, getService).listGear()))
  v1.put('/gear/:id', async (c) => {
    const id = param(c, 'id')
    const input = await body(c, PutGearBody)
    return c.json(await service(c, getService).saveGear({ ...input, id }))
  })
  v1.delete('/gear/:id', async (c) => {
    const id = param(c, 'id')
    const s = service(c, getService)
    if (!(await s.owns('gear', id))) return c.json({ error: 'not_found' }, 404)
    await s.deleteGear(id)
    return c.body(null, 204)
  })
}
