import { describe, expect, it } from 'vitest'
import { AppDb } from '../src/repo/db'
import { LocalRepo } from '../src/repo/local-repo'

async function setup() {
  const db = new AppDb(crypto.randomUUID())
  const repo = new LocalRepo(db)
  await repo.init()
  const [ex1, ex2] = await repo.listExercises()
  if (!ex1 || !ex2) throw new Error('seed missing')
  const planA = await repo.savePlan({ name: 'Plan B' })
  const planB = await repo.savePlan({ name: 'Plan A' })
  const dayA = await repo.savePlanDay({ plan_id: planA.id, name: 'D1' })
  const dayB = await repo.savePlanDay({ plan_id: planB.id, name: 'D1' })
  const itemA1 = await repo.addPlanItem(dayA.id, ex1.id)
  const itemA2 = await repo.addPlanItem(dayA.id, ex2.id)
  const itemB1 = await repo.addPlanItem(dayB.id, ex1.id)
  return { db, repo, ex1, ex2, planA, planB, dayA, dayB, itemA1, itemA2, itemB1 }
}

describe('deleteExercise cascade', () => {
  it('soft-deletes the exercise and its plan items, leaving others', async () => {
    const { db, repo, ex1, planA, planB, itemA1, itemB1, itemA2 } = await setup()
    await repo.deleteExercise(ex1.id)
    expect((await repo.listExercises()).some((e) => e.id === ex1.id)).toBe(false)
    expect((await repo.getPlan(planA.id))!.days[0]!.items.map((i) => i.id)).toEqual([itemA2.id])
    expect((await repo.getPlan(planB.id))!.days[0]!.items).toEqual([])
    expect((await db.planItems.get(itemA1.id))?.deleted_at).not.toBeNull()
    expect((await db.planItems.get(itemB1.id))?.deleted_at).not.toBeNull()
    expect((await db.planItems.get(itemA2.id))?.deleted_at).toBeNull()
  })

  it('is a no-op for unknown or already-deleted ids', async () => {
    const { repo, ex1 } = await setup()
    await repo.deleteExercise('nope')
    await repo.deleteExercise(ex1.id)
    await repo.deleteExercise(ex1.id)
    expect((await repo.listExercises()).some((e) => e.id === ex1.id)).toBe(false)
  })

  it('history keeps the original name after the exercise is deleted', async () => {
    const { repo, ex1, dayA } = await setup()
    const detail = await repo.startSession(dayA.id)
    for (const g of detail.exercises)
      for (const set of g.sets) await repo.updateSet(set.id, { done: true })
    await repo.finishSession(detail.id)
    await repo.deleteExercise(ex1.id)
    const shown = await repo.getSession(detail.id)
    expect(shown!.exercises.map((e) => e.exercise_name)).toContain(ex1.name)
  })

  it('an in-progress workout still finishes cleanly after its exercise is deleted', async () => {
    const { repo, ex1, ex2, dayA } = await setup()
    const detail = await repo.startSession(dayA.id)
    await repo.deleteExercise(ex1.id)
    const summary = await repo.finishSession(detail.id)
    expect(summary.find((s) => s.exercise_name === ex1.name)?.outcome).toBe('skipped')
    expect(summary.some((s) => s.exercise_name === ex2.name)).toBe(true)
    const done = await repo.getSession(detail.id)
    expect(done!.exercises.map((e) => e.exercise_name)).toContain(ex1.name)
  })
})

describe('exerciseUsage', () => {
  it('counts live items and lists distinct sorted plan names', async () => {
    const { repo, ex1, ex2, dayA, itemA1 } = await setup()
    expect(await repo.exerciseUsage(ex1.id)).toEqual({ planItemCount: 2, plans: ['Plan A', 'Plan B'] })
    await repo.addPlanItem(dayA.id, ex1.id)
    expect((await repo.exerciseUsage(ex1.id)).planItemCount).toBe(3)
    await repo.deletePlanItem(itemA1.id)
    expect((await repo.exerciseUsage(ex1.id)).planItemCount).toBe(2)
    expect(await repo.exerciseUsage(ex2.id)).toEqual({ planItemCount: 1, plans: ['Plan B'] })
    expect(await repo.exerciseUsage('nope')).toEqual({ planItemCount: 0, plans: [] })
  })

  it('ignores items in deleted plans', async () => {
    const { repo, ex1, planB } = await setup()
    await repo.deletePlan(planB.id)
    expect(await repo.exerciseUsage(ex1.id)).toEqual({ planItemCount: 1, plans: ['Plan B'] })
  })
})

describe('deleteGear', () => {
  it('hides the gear and strips it from live exercises, which stay', async () => {
    const { repo } = await setup()
    const gear = await repo.saveGear({ name: 'Sled', owned: false })
    const [base] = await repo.listExercises()
    const { user_id: _u, created_at: _c, updated_at: _up, deleted_at: _d, id: _i, ...input } = base!
    const ex = await repo.saveExercise({ ...input, name: 'Sled Push', required_gear_ids: [gear.id], active: true })
    await repo.deleteGear(gear.id)
    expect((await repo.listGear()).some((g) => g.id === gear.id)).toBe(false)
    const after = (await repo.listExercises()).find((e) => e.id === ex.id)!
    expect(after.required_gear_ids).toEqual([])
    expect(after.updated_at >= ex.updated_at).toBe(true)
  })

  it('is a no-op for unknown ids', async () => {
    const { repo } = await setup()
    const before = await repo.listGear()
    await repo.deleteGear('nope')
    expect(await repo.listGear()).toEqual(before)
  })
})
