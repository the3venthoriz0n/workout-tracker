import { describe, expect, it } from 'vitest'
import { defaultRule } from '@workout/shared'
import { AppDb } from '../src/repo/db'
import { LocalRepo } from '../src/repo/local-repo'
import { ExerciseInUseError } from '../src/repo/types'

async function setup() {
  const db = new AppDb(crypto.randomUUID())
  const repo = new LocalRepo(db)
  await repo.init()
  const [ex1, ex2] = await repo.listExercises()
  if (!ex1 || !ex2) throw new Error('seed missing')
  const plan = await repo.savePlan({ name: 'PPL' })
  const day1 = await repo.savePlanDay({ plan_id: plan.id, name: 'Push' })
  const day2 = await repo.savePlanDay({ plan_id: plan.id, name: 'Pull' })
  const item1 = await repo.addPlanItem(day1.id, ex1.id)
  const item2 = await repo.addPlanItem(day1.id, ex2.id)
  return { db, repo, ex1, ex2, plan, day1, day2, item1, item2 }
}

describe('LocalRepo plans', () => {
  it('getPlan returns days and items in position order with exercise, rule and effective', async () => {
    const { repo, plan, day1, day2, item1, item2, ex1 } = await setup()
    const tree = await repo.getPlan(plan.id)
    expect(tree?.days.map((d) => d.id)).toEqual([day1.id, day2.id])
    const items = tree?.days[0]?.items ?? []
    expect(items.map((i) => i.id)).toEqual([item1.id, item2.id])
    expect(items[0]?.exercise.id).toBe(ex1.id)
    expect(items[0]?.rule).toMatchObject(defaultRule(5))
    expect(items[0]?.effective.baseReps).toBe(ex1.default_reps)
    expect(tree?.days[1]?.items).toEqual([])
  })

  it('move swaps positions; no-op at the ends', async () => {
    const { repo, plan, day1, item1, item2 } = await setup()
    await repo.move('item', item1.id, -1)
    await repo.move('item', item2.id, 1)
    let ids = (await repo.getPlan(plan.id))?.days[0]?.items.map((i) => i.id)
    expect(ids).toEqual([item1.id, item2.id])
    await repo.move('item', item2.id, -1)
    ids = (await repo.getPlan(plan.id))?.days[0]?.items.map((i) => i.id)
    expect(ids).toEqual([item2.id, item1.id])
    await repo.move('day', day1.id, 1)
    expect((await repo.getPlan(plan.id))?.days.map((d) => d.name)).toEqual(['Pull', 'Push'])
  })

  it('editing weight clears targets and fail_streak', async () => {
    const { db, repo, item1 } = await setup()
    await db.planItems.update(item1.id, { target_weight: 110, target_reps: 6 })
    await db.itemStates.update(item1.id, { fail_streak: 2 })
    const updated = await repo.updatePlanItem(item1.id, { weight: 100 })
    expect(updated).toMatchObject({ weight: 100, target_weight: null, target_reps: null })
    expect((await db.itemStates.get(item1.id))?.fail_streak).toBe(0)
  })

  it('reps: null stores null and effective falls back to the exercise default', async () => {
    const { repo, plan, item1, ex1 } = await setup()
    await repo.updatePlanItem(item1.id, { reps: 12 })
    const updated = await repo.updatePlanItem(item1.id, { reps: null })
    expect(updated.reps).toBeNull()
    const item = (await repo.getPlan(plan.id))?.days[0]?.items[0]
    expect(item?.effective.baseReps).toBe(ex1.default_reps)
  })

  it('editing sets alone keeps targets', async () => {
    const { db, repo, item1 } = await setup()
    await db.planItems.update(item1.id, { target_weight: 110, target_reps: 6 })
    await db.itemStates.update(item1.id, { fail_streak: 2 })
    const updated = await repo.updatePlanItem(item1.id, { sets: 4 })
    expect(updated).toMatchObject({ sets: 4, target_weight: 110, target_reps: 6 })
    expect((await db.itemStates.get(item1.id))?.fail_streak).toBe(2)
  })

  it('deleteExercise is blocked while a live item uses it', async () => {
    const { repo, item1, ex1 } = await setup()
    await expect(repo.deleteExercise(ex1.id)).rejects.toBeInstanceOf(ExerciseInUseError)
    await repo.deletePlanItem(item1.id)
    await repo.deleteExercise(ex1.id)
    expect((await repo.listExercises()).some((e) => e.id === ex1.id)).toBe(false)
  })

  it('deletePlan hides the plan, days and items', async () => {
    const { db, repo, plan, item1 } = await setup()
    await repo.deletePlan(plan.id)
    expect(await repo.listPlans()).toEqual([])
    expect(await repo.getPlan(plan.id)).toBeUndefined()
    expect((await db.planItems.get(item1.id))?.deleted_at).not.toBeNull()
  })

  it('setRule(null) removes the rule; setRule(rule) upserts', async () => {
    const { repo, plan, item1 } = await setup()
    await repo.setRule(item1.id, null)
    expect((await repo.getPlan(plan.id))?.days[0]?.items[0]?.rule).toBeNull()
    await repo.setRule(item1.id, { ...defaultRule(5), success_amount: 2.5 })
    expect((await repo.getPlan(plan.id))?.days[0]?.items[0]?.rule?.success_amount).toBe(2.5)
    await expect(repo.setRule(item1.id, { ...defaultRule(5), success_amount: 0 })).rejects.toThrow()
  })

  it('listPlans returns plans in creation order', async () => {
    const repo = new LocalRepo(new AppDb(crypto.randomUUID()))
    await repo.init()
    const names = ['Zulu', 'Alpha', 'Mike']
    for (const name of names) {
      await repo.savePlan({ name })
      await new Promise((r) => setTimeout(r, 3))
    }
    expect((await repo.listPlans()).map((p) => p.name)).toEqual(names)
  })
})
