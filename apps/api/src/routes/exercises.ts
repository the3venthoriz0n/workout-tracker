import { PutExerciseBody } from '@workout/shared'
import { body, param, service } from './http.js'
import type { RouteDeps, V1 } from './types.js'

export function registerExercises(v1: V1, { getService }: RouteDeps) {
  v1.get('/exercises', async (c) => c.json(await service(c, getService).listExercises()))
  v1.put('/exercises/:id', async (c) => {
    const id = param(c, 'id')
    const input = await body(c, PutExerciseBody)
    return c.json(await service(c, getService).saveExercise({ ...input, id }))
  })
  v1.delete('/exercises/:id', async (c) => {
    const id = param(c, 'id')
    const s = service(c, getService)
    if (!(await s.owns('exercise', id))) return c.json({ error: 'not_found' }, 404)
    await s.deleteExercise(id)
    return c.body(null, 204)
  })
  v1.get('/exercises/:id/usage', async (c) => {
    const id = param(c, 'id')
    const s = service(c, getService)
    if (!(await s.owns('exercise', id))) return c.json({ error: 'not_found' }, 404)
    return c.json(await s.exerciseUsage(id))
  })
}
