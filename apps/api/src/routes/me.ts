import { PatchProfileBody } from '@workout/shared'
import { body, service } from './http.js'
import type { RouteDeps, V1 } from './types.js'

export function registerMe(v1: V1, { getService }: RouteDeps) {
  v1.post('/me/init', async (c) => {
    const s = service(c, getService)
    await s.init()
    return c.json(await s.getProfile())
  })
  v1.get('/me', async (c) => c.json(await service(c, getService).getProfile()))
  v1.patch('/me', async (c) => {
    const patch = await body(c, PatchProfileBody)
    return c.json(await service(c, getService).updateProfile(patch))
  })
}
