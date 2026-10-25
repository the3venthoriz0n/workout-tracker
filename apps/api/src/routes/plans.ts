import { AddItemBody, MoveBody, PatchItemBody, PutDayBody, PutPlanBody, PutRuleBody, PutSupersetBody } from '@workout/shared'
import { body, param, service } from './http.js'
import type { RouteDeps, V1 } from './types.js'

export function registerPlans(v1: V1, { getService }: RouteDeps) {
  v1.get('/plans', async (c) => c.json(await service(c, getService).listPlans()))
  v1.get('/plans/:id', async (c) => {
    const found = await service(c, getService).getPlan(param(c, 'id'))
    return found ? c.json(found) : c.json({ error: 'not_found' }, 404)
  })
  v1.put('/plans/:id', async (c) => {
    const id = param(c, 'id')
    const input = await body(c, PutPlanBody)
    return c.json(await service(c, getService).savePlan({ ...input, id }))
  })
  v1.delete('/plans/:id', async (c) => {
    const id = param(c, 'id')
    const s = service(c, getService)
    if (!(await s.owns('plan', id))) return c.json({ error: 'not_found' }, 404)
    await s.deletePlan(id)
    return c.body(null, 204)
  })

  v1.put('/days/:id', async (c) => {
    const id = param(c, 'id')
    const input = await body(c, PutDayBody)
    return c.json(await service(c, getService).savePlanDay({ ...input, id }))
  })
  v1.delete('/days/:id', async (c) => {
    const id = param(c, 'id')
    const s = service(c, getService)
    if (!(await s.owns('day', id))) return c.json({ error: 'not_found' }, 404)
    await s.deletePlanDay(id)
    return c.body(null, 204)
  })

  v1.post('/days/:dayId/items', async (c) => {
    const dayId = param(c, 'dayId')
    const input = await body(c, AddItemBody)
    return c.json(await service(c, getService).addPlanItem(dayId, input.exercise_id, input.id), 201)
  })
  v1.patch('/items/:id', async (c) => {
    const id = param(c, 'id')
    const patch = await body(c, PatchItemBody)
    return c.json(await service(c, getService).updatePlanItem(id, patch))
  })
  v1.delete('/items/:id', async (c) => {
    const id = param(c, 'id')
    const s = service(c, getService)
    if (!(await s.owns('item', id))) return c.json({ error: 'not_found' }, 404)
    await s.deletePlanItem(id)
    return c.body(null, 204)
  })
  v1.put('/items/:id/rule', async (c) => {
    const id = param(c, 'id')
    const { rule } = await body(c, PutRuleBody)
    await service(c, getService).setRule(id, rule)
    return c.json({ rule })
  })
  v1.delete('/items/:id/rule', async (c) => {
    await service(c, getService).clearRule(param(c, 'id'))
    return c.body(null, 204)
  })
  v1.put('/days/:dayId/supersets/:groupId', async (c) => {
    const dayId = param(c, 'dayId')
    const groupId = param(c, 'groupId')
    const { item_ids } = await body(c, PutSupersetBody)
    await service(c, getService).setSuperset(dayId, groupId, item_ids)
    return c.json({ superset_group: item_ids === null ? null : groupId })
  })
  v1.post('/move', async (c) => {
    const { kind, id, direction } = await body(c, MoveBody)
    await service(c, getService).move(kind, id, direction)
    return c.body(null, 204)
  })
}
