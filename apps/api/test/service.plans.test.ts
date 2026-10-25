import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { NotFoundError, defaultRule, newId } from '@workout/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as t from '../src/db/schema.js'
import { createService } from '../src/service/index.js'
import { type TestDb, withTestDb } from './harness.js'

let h: TestDb
beforeEach(async () => {
  h = await withTestDb()
})
afterEach(async () => {
  await h?.cleanup()
})

async function makeService() {
  const id = `u_${randomUUID()}`
  await h.db.insert(t.user).values({ id, name: id, email: `${id}@example.test` })
  const s = createService(h.db, id)
  await s.init()
  return { s, userId: id }
}

async function setup() {
  const { s, userId } = await makeService()
  const ex = (await s.listExercises())[0]!
  const plan = await s.savePlan({ name: 'P' })
  const day = await s.savePlanDay({ plan_id: plan.id, name: 'D' })
  return { s, userId, ex, plan, day }
}

const ids = async (s: ReturnType<typeof createService>, planId: string) => {
  const tree = (await s.getPlan(planId))!
  return { days: tree.days.map((d) => d.id), items: tree.days.flatMap((d) => d.items.map((i) => i.id)) }
}

describe('service plans', () => {
  it('two users can use the SAME client ids and see only their own', async () => {
    const a = await makeService()
    const b = await makeService()
    const planId = newId()
    const dayId = newId()
    const exId = newId()
    for (const [x, name] of [[a.s, 'A'], [b.s, 'B']] as const) {
      await x.saveExercise({ id: exId, name: `Ex ${name}`, notes: '', video_url: null, required_gear_ids: [], active: true, default_sets: 3, default_reps: 5, default_weight: 50 })
      await x.savePlan({ id: planId, name: `Plan ${name}` })
      await x.savePlanDay({ id: dayId, plan_id: planId, name: `Day ${name}` })
      await x.addPlanItem(dayId, exId)
    }
    for (const [x, name] of [[a.s, 'A'], [b.s, 'B']] as const) {
      const tree = (await x.getPlan(planId))!
      expect(tree.name).toBe(`Plan ${name}`)
      expect(tree.days).toHaveLength(1)
      expect(tree.days[0]!.name).toBe(`Day ${name}`)
      expect(tree.days[0]!.items.map((i) => i.exercise.name)).toEqual([`Ex ${name}`])
      expect(await x.listPlans()).toHaveLength(1)
      expect(await x.listProgression()).toHaveLength(1)
    }
  })

  it("another user's ids behave as not found and change nothing", async () => {
    const a = await setup()
    const item = await a.s.addPlanItem(a.day.id, a.ex.id)
    const item2 = await a.s.addPlanItem(a.day.id, a.ex.id)
    const b = await makeService()
    const bEx = (await b.s.listExercises())[0]!
    const before = await ids(a.s, a.plan.id)
    const snapshot = JSON.stringify(await a.s.getPlan(a.plan.id))

    await expect(b.s.addPlanItem(a.day.id, bEx.id)).rejects.toBeInstanceOf(NotFoundError)
    await expect(b.s.savePlanDay({ plan_id: a.plan.id, name: 'x' })).rejects.toBeInstanceOf(NotFoundError)
    await expect(b.s.updatePlanItem(item.id, { reps: 9 })).rejects.toBeInstanceOf(NotFoundError)
    await expect(b.s.move('item', item.id, 1)).rejects.toBeInstanceOf(NotFoundError)
    await expect(b.s.move('day', a.day.id, 1)).rejects.toBeInstanceOf(NotFoundError)
    await expect(b.s.setRule(item.id, null)).rejects.toBeInstanceOf(NotFoundError)
    await expect(b.s.setRule(item.id, defaultRule(5))).rejects.toBeInstanceOf(NotFoundError)
    expect(await b.s.getPlan(a.plan.id)).toBeUndefined()
    await b.s.deletePlan(a.plan.id)
    await b.s.deletePlanDay(a.day.id)
    await b.s.deletePlanItem(item.id)
    await b.s.deleteExercise(a.ex.id)

    expect(JSON.stringify(await a.s.getPlan(a.plan.id))).toBe(snapshot)
    expect(await ids(a.s, a.plan.id)).toEqual(before)
    expect(item2.id).toBeDefined()
  })

  it('addPlanItem with a foreign exercise id is rejected', async () => {
    const a = await makeService()
    const b = await setup()
    const aEx = (await a.s.listExercises())[0]!
    await expect(b.s.addPlanItem(b.day.id, aEx.id)).rejects.toBeInstanceOf(NotFoundError)
    expect((await b.s.getPlan(b.plan.id))!.days[0]!.items).toHaveLength(0)
  })

  it('move handles gaps in positions and is a no-op at both ends', async () => {
    const { s, ex, plan, day } = await setup()
    const i1 = await s.addPlanItem(day.id, ex.id)
    const i2 = await s.addPlanItem(day.id, ex.id)
    const i3 = await s.addPlanItem(day.id, ex.id)
    const i4 = await s.addPlanItem(day.id, ex.id)
    await s.deletePlanItem(i2.id) // positions 0,2,3 remain
    expect((await ids(s, plan.id)).items).toEqual([i1.id, i3.id, i4.id])
    await s.move('item', i1.id, -1)
    await s.move('item', i4.id, 1)
    expect((await ids(s, plan.id)).items).toEqual([i1.id, i3.id, i4.id])
    await s.move('item', i1.id, 1)
    expect((await ids(s, plan.id)).items).toEqual([i3.id, i1.id, i4.id])
    await s.move('item', i4.id, -1)
    expect((await ids(s, plan.id)).items).toEqual([i3.id, i4.id, i1.id])

    const d2 = await s.savePlanDay({ plan_id: plan.id, name: 'D2' })
    const d3 = await s.savePlanDay({ plan_id: plan.id, name: 'D3' })
    await s.deletePlanDay(d2.id)
    await s.move('day', day.id, -1)
    await s.move('day', d3.id, 1)
    expect((await ids(s, plan.id)).days).toEqual([day.id, d3.id])
    await s.move('day', day.id, 1)
    expect((await ids(s, plan.id)).days).toEqual([d3.id, day.id])
  })

  it('positions never collide after delete + add', async () => {
    const { s, ex, plan, day } = await setup()
    const a = await s.addPlanItem(day.id, ex.id)
    const b = await s.addPlanItem(day.id, ex.id)
    await s.deletePlanItem(a.id)
    const c = await s.addPlanItem(day.id, ex.id)
    await s.deletePlanItem(c.id)
    const d = await s.addPlanItem(day.id, ex.id)
    expect(b.position).toBeLessThan(c.position)
    expect(d.position).toBeGreaterThan(b.position)
    const live = (await s.getPlan(plan.id))!.days[0]!.items.map((i) => i.position)
    expect(new Set(live).size).toBe(live.length)
    const d2 = await s.savePlanDay({ plan_id: plan.id, name: 'x' })
    await s.deletePlanDay(d2.id)
    const d3 = await s.savePlanDay({ plan_id: plan.id, name: 'y' })
    expect(d3.position).toBeGreaterThan(day.position)
  })

  it('concurrent appends get distinct positions', async () => {
    const { s, ex, plan, day } = await setup()
    await Promise.all([1, 2, 3, 4].map(() => s.addPlanItem(day.id, ex.id)))
    const pos = (await s.getPlan(plan.id))!.days[0]!.items.map((i) => i.position)
    expect(pos).toEqual([0, 1, 2, 3])
  })

  it('deleting an exercise removes its items from getPlan and listProgression; an orphaned rule never surfaces', async () => {
    const { s, userId, ex, plan, day } = await setup()
    const other = (await s.listExercises())[1]!
    const gone = await s.addPlanItem(day.id, ex.id)
    await s.setRule(gone.id, defaultRule(5)) // an override, so the item has a rule row
    const kept = await s.addPlanItem(day.id, other.id)
    await s.deleteExercise(ex.id)
    expect((await ids(s, plan.id)).items).toEqual([kept.id])
    expect((await s.listProgression()).map((r) => r.item_id)).toEqual([kept.id])
    // the rule row is left behind like LocalRepo, but never surfaces
    const rules = await h.db.select().from(t.progressionRule).where(and(eq(t.progressionRule.userId, userId), eq(t.progressionRule.planItemId, gone.id)))
    expect(rules).toHaveLength(1)
    // an inactive exercise is still resolved
    await s.saveExercise({ ...other, active: false })
    expect((await s.getPlan(plan.id))!.days[0]!.items[0]!.exercise.active).toBe(false)
  })

  it('addPlanItem into a soft-deleted day or plan is rejected; deletes cascade', async () => {
    const { s, userId, ex, plan, day } = await setup()
    const item = await s.addPlanItem(day.id, ex.id)
    await s.deletePlanDay(day.id)
    await expect(s.addPlanItem(day.id, ex.id)).rejects.toBeInstanceOf(NotFoundError)
    const [row] = await h.db.select().from(t.planItem).where(and(eq(t.planItem.userId, userId), eq(t.planItem.id, item.id)))
    expect(row!.deletedAt).not.toBeNull()

    const day2 = await s.savePlanDay({ plan_id: plan.id, name: 'D2' })
    const item2 = await s.addPlanItem(day2.id, ex.id)
    await s.deletePlan(plan.id)
    expect(await s.getPlan(plan.id)).toBeUndefined()
    expect(await s.listProgression()).toEqual([])
    await expect(s.savePlanDay({ plan_id: plan.id, name: 'x' })).rejects.toBeInstanceOf(NotFoundError)
    const [row2] = await h.db.select().from(t.planItem).where(and(eq(t.planItem.userId, userId), eq(t.planItem.id, item2.id)))
    expect(row2!.deletedAt).not.toBeNull()
    await expect(s.updatePlanItem(item2.id, { sets: 2 })).rejects.toBeInstanceOf(NotFoundError)
  })

  it('unknown or foreign ids on deletes are harmless no-ops', async () => {
    const { s, plan } = await setup()
    for (const id of [newId(), 'not-a-uuid']) {
      await s.deletePlan(id)
      await s.deletePlanDay(id)
      await s.deletePlanItem(id)
      await s.deleteExercise(id)
      expect(await s.getPlan(id)).toBeUndefined()
    }
    expect(await s.getPlan(plan.id)).toBeDefined()
  })

  it('addPlanItem seeds the rule and a zero fail streak; edits to reps/weight clear targets and the streak, sets does not', async () => {
    const { s, userId, ex, plan, day } = await setup()
    const item = await s.addPlanItem(day.id, ex.id)
    const tree = await s.getPlan(plan.id)
    expect(tree!.days[0]!.items[0]!.rule).toMatchObject(defaultRule(5))
    const where = and(eq(t.itemState.userId, userId), eq(t.itemState.planItemId, item.id))
    const [state] = await h.db.select().from(t.itemState).where(where)
    expect(state!.failStreak).toBe(0)

    await h.db.update(t.planItem).set({ targetReps: 6, targetWeight: '77.50' }).where(and(eq(t.planItem.userId, userId), eq(t.planItem.id, item.id)))
    await h.db.update(t.itemState).set({ failStreak: 2 }).where(where)
    const keep = await s.updatePlanItem(item.id, { sets: 4 })
    expect(keep).toMatchObject({ sets: 4, target_reps: 6, target_weight: 77.5 })
    expect((await h.db.select().from(t.itemState).where(where))[0]!.failStreak).toBe(2)
    const cleared = await s.updatePlanItem(item.id, { weight: 60.25 })
    expect(cleared).toMatchObject({ sets: 4, weight: 60.25, target_reps: null, target_weight: null })
    expect((await h.db.select().from(t.itemState).where(where))[0]!.failStreak).toBe(0)
    expect(await s.updatePlanItem(item.id, { weight: null, sets: null })).toMatchObject({ weight: null, sets: null })
    await expect(s.updatePlanItem(item.id, { reps: 0 })).rejects.toThrow()

    await s.updateProfile({ default_rule: { success_action: 'add_reps', success_amount: 1, fail_streak_limit: 2, deload_pct: 20, rep_ceiling: 12 } })
    const second = await s.addPlanItem(day.id, ex.id)
    const t2 = (await s.getPlan(plan.id))!.days[0]!.items.find((i) => i.id === second.id)!
    expect(t2.rule).toMatchObject({ success_action: 'add_reps', rep_ceiling: 12 })
  })

  it('setRule upserts, validates, and null removes only the rule', async () => {
    const { s, ex, plan, day } = await setup()
    const item = await s.addPlanItem(day.id, ex.id)
    await s.setRule(item.id, { success_action: 'add_weight', success_amount: 7.5, fail_streak_limit: 2, deload_pct: 5, rep_ceiling: null })
    expect((await s.getPlan(plan.id))!.days[0]!.items[0]!.rule).toMatchObject({ success_amount: 7.5, fail_streak_limit: 2 })
    await expect(s.setRule(item.id, { success_action: 'add_weight', success_amount: 0, fail_streak_limit: 2, deload_pct: 5, rep_ceiling: null })).rejects.toThrow()
    await s.setRule(item.id, null)
    expect((await s.getPlan(plan.id))!.days[0]!.items[0]!.rule).toBeNull()
    expect((await s.listProgression())[0]!.rule).toBeNull()
  })

  it('a delete committing while setSuperset waits cannot leave a one-member group', async () => {
    const { s, userId, ex, plan, day } = await setup()
    const a = await s.addPlanItem(day.id, ex.id)
    const b = await s.addPlanItem(day.id, ex.id)
    const g = newId()
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    let locked!: () => void
    const hasLock = new Promise<void>((r) => (locked = r))
    // A concurrent delete: locks and soft-deletes b, then commits after setSuperset has started.
    const deleter = h.db.transaction(async (tx) => {
      await tx.update(t.planItem).set({ deletedAt: new Date() }).where(and(eq(t.planItem.userId, userId), eq(t.planItem.id, b.id)))
      locked()
      await gate
    })
    await hasLock
    const grouping = s.setSuperset(day.id, g, [a.id, b.id]).then(
      () => 'ok',
      (e: unknown) => (e instanceof NotFoundError ? 'not_found' : String(e)),
    )
    await new Promise((r) => setTimeout(r, 300))
    release()
    await deleter
    expect(await grouping).toBe('not_found')
    const items = (await s.getPlan(plan.id))!.days.flatMap((d) => d.items)
    expect(items.map((i) => i.superset_group)).toEqual([null])
  })
})
