import { ImportBody } from '@workout/shared'
import { body, service } from './http.js'
import type { RouteDeps, V1 } from './types.js'

export function registerTransfer(v1: V1, { getService }: RouteDeps) {
  v1.get('/export', async (c) => c.json(await service(c, getService).exportAll()))
  v1.post('/import', async (c) => {
    const data = await body(c, ImportBody)
    await service(c, getService).importAll(data)
    return c.body(null, 204)
  })
}
