import { defaultRule, type RuleInput } from '@workout/shared'
import { describe, expect, it } from 'vitest'
import { AppDb } from '../src/repo/db'
import { LocalRepo } from '../src/repo/local-repo'

async function setup() {
  const db = new AppDb(crypto.randomUUID())
  const repo = new LocalRepo(db)
  await repo.init()
  const [ex1, ex2] = await repo.listExercises()
  if (!ex1 || !ex2) throw new Error('seed missing')
  return { db, repo, ex1, ex2 }
}

const custom: RuleInput = {
  success_action: 'add_weight',
  success_amount: 10,
  fail_streak_limit: 2,
  deload_pct: 20,
  rep_ceiling: null,
}

describe('profile default_rule', () => {
  it('is absent by default and new items get defaultRule(step)', async () => {
    const { repo, ex1 } = await setup()
    expect((await repo.getProfile()).default_rule).toBeUndefined()
    const plan = await repo.savePlan({ name: 'A' })
    const day = await repo.savePlanDay({ plan_id: plan.id, name: 'D' })
    const item = await repo.addPlanItem(day.id, ex1.id)
    const tree = await repo.getPlan(plan.id)
    expect(tree?.days[0]?.items.find((i) => i.id === item.id)?.rule).toMatchObject(defaultRule(5))
  })

  it('addPlanItem uses the stored default rule', async () => {
    const { repo, ex1 } = await setup()
    await repo.updateProfile({ default_rule: custom })
    expect((await repo.getProfile()).default_rule).toEqual(custom)
    const plan = await repo.savePlan({ name: 'A' })
    const day = await repo.savePlanDay({ plan_id: plan.id, name: 'D' })
    await repo.addPlanItem(day.id, ex1.id)
    const rule = (await repo.getPlan(plan.id))?.days[0]?.items[0]?.rule
    expect(rule).toMatchObject(custom)
  })

  it('rejects an invalid default rule', async () => {
    const { repo } = await setup()
    await expect(
      repo.updateProfile({ default_rule: { ...custom, success_amount: 0 } }),
    ).rejects.toThrow()
  })

  it('unit switch converts an add_weight default; add_reps is untouched', async () => {
    const { repo } = await setup()
    await repo.updateProfile({ default_rule: custom })
    await repo.updateProfile({ units: 'kg' })
    const p = await repo.getProfile()
    expect(p.weight_increment).toBe(2.5)
    expect(p.default_rule?.success_amount).toBe(5) // 10 lb -> 4.5 kg -> nearest 2.5

    const reps: RuleInput = { ...custom, success_action: 'add_reps', success_amount: 2 }
    await repo.updateProfile({ default_rule: reps })
    await repo.updateProfile({ units: 'lb' })
    expect((await repo.getProfile()).default_rule?.success_amount).toBe(2)
  })

  it('a default equal to the old step becomes the new unit default', async () => {
    const { repo } = await setup()
    await repo.updateProfile({ default_rule: defaultRule(5) })
    await repo.updateProfile({ units: 'kg' })
    expect((await repo.getProfile()).default_rule?.success_amount).toBe(2.5)
  })

  it('a legacy profile without default_rule still loads', async () => {
    const { db, repo, ex1 } = await setup()
    await repo.updateProfile({ default_rule: custom })
    const raw = (await db.profile.toCollection().first()) as unknown as Record<string, unknown>
    expect(raw.default_rule).toBeDefined()
    const { default_rule: _drop, ...legacy } = raw
    await db.profile.put(legacy as never) // same key, field removed
    expect(Object.keys((await db.profile.toCollection().first()) as object)).not.toContain(
      'default_rule',
    )
    expect((await repo.getProfile()).default_rule).toBeUndefined()
    const plan = await repo.savePlan({ name: 'A' })
    const day = await repo.savePlanDay({ plan_id: plan.id, name: 'D' })
    await repo.addPlanItem(day.id, ex1.id)
    expect((await repo.getPlan(plan.id))?.days[0]?.items[0]?.rule).toMatchObject(defaultRule(5))
    await repo.updateProfile({ units: 'kg' })
    expect((await repo.getProfile()).units).toBe('kg')
  })
})

describe('listProgression', () => {
  it('lists live items ordered by plan, day and item position, with rules', async () => {
    const { repo, ex1, ex2 } = await setup()
    const p1 = await repo.savePlan({ name: 'One' })
    const p2 = await repo.savePlan({ name: 'Two' })
    const d1 = await repo.savePlanDay({ plan_id: p1.id, name: 'A' })
    const d2 = await repo.savePlanDay({ plan_id: p1.id, name: 'B' })
    const d3 = await repo.savePlanDay({ plan_id: p2.id, name: 'C' })
    const i1 = await repo.addPlanItem(d1.id, ex1.id)
    const i2 = await repo.addPlanItem(d1.id, ex2.id)
    const i3 = await repo.addPlanItem(d2.id, ex1.id)
    const i4 = await repo.addPlanItem(d3.id, ex2.id)
    await repo.setRule(i2.id, null)
    const rows = await repo.listProgression()
    expect(rows.map((r) => r.item_id)).toEqual([i1.id, i2.id, i3.id, i4.id])
    expect(rows[0]).toMatchObject({
      plan_id: p1.id,
      plan_name: 'One',
      day_id: d1.id,
      day_name: 'A',
      exercise_name: ex1.name,
    })
    expect(rows[0]?.rule).toMatchObject(defaultRule(5))
    expect(rows[1]?.rule).toBeNull()
  })

  it('skips soft-deleted plans, days and items', async () => {
    const { repo, ex1 } = await setup()
    const p1 = await repo.savePlan({ name: 'One' })
    const p2 = await repo.savePlan({ name: 'Two' })
    const d1 = await repo.savePlanDay({ plan_id: p1.id, name: 'A' })
    const d2 = await repo.savePlanDay({ plan_id: p1.id, name: 'B' })
    const d3 = await repo.savePlanDay({ plan_id: p2.id, name: 'C' })
    const keep = await repo.addPlanItem(d1.id, ex1.id)
    const gone = await repo.addPlanItem(d1.id, ex1.id)
    await repo.addPlanItem(d2.id, ex1.id)
    await repo.addPlanItem(d3.id, ex1.id)
    await repo.deletePlanItem(gone.id)
    await repo.deletePlanDay(d2.id)
    await repo.deletePlan(p2.id)
    expect((await repo.listProgression()).map((r) => r.item_id)).toEqual([keep.id])
  })

  it('does not list plan items removed by deleting their exercise (and ignores their orphaned rules)', async () => {
    const { repo, db, ex1, ex2 } = await setup()
    const plan = await repo.savePlan({ name: 'A' })
    const day = await repo.savePlanDay({ plan_id: plan.id, name: 'D' })
    const gone = await repo.addPlanItem(day.id, ex1.id)
    await repo.setRule(gone.id, defaultRule(5)) // an override, so the item has a rule row
    const kept = await repo.addPlanItem(day.id, ex2.id)
    expect((await repo.listProgression()).map((r) => r.item_id)).toEqual([gone.id, kept.id])

    await repo.deleteExercise(ex1.id)

    // The cascade leaves the removed item's rule row behind; the list must not surface it.
    expect(await db.rules.get(gone.id)).toBeDefined()
    expect((await repo.listProgression()).map((r) => r.item_id)).toEqual([kept.id])
  })
})
