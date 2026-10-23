import { service } from './http.js'
import type { RouteDeps, V1 } from './types.js'

export function registerProgression(v1: V1, { getService }: RouteDeps) {
  v1.get('/progression', async (c) => c.json(await service(c, getService).listProgression()))
}
