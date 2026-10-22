import { defaultRule } from '@workout/shared'
import { describe, expect, it } from 'vitest'
import { AppDb } from '../src/repo/db'
import { LocalRepo } from '../src/repo/local-repo'
import { SessionInProgressError } from '../src/repo/types'

async function setup() {
  const db = new AppDb(crypto.randomUUID())
  const repo = new LocalRepo(db)
  await repo.init()
  const exercises = await repo.listExercises()
  const bench = exercises.find((e) => e.name === 'Bench Press')
  const other = exercises.find((e) => e.id !== bench?.id)
  if (!bench || !other) throw new Error('seed missing')
  const plan = await repo.savePlan({ name: 'PPL' })
  const day = await repo.savePlanDay({ plan_id: plan.id, name: 'Push' })
  const benchItem = await repo.addPlanItem(day.id, bench.id)
  await repo.updatePlanItem(benchItem.id, { sets: 3, reps: 5, weight: 95 })
  const otherItem = await repo.addPlanItem(day.id, other.id)
  return { db, repo, bench, other, plan, day, benchItem, otherItem }
}

async function setupSingle() {
  const ctx = await setup()
  await ctx.repo.deletePlanItem(ctx.otherItem.id)
  return ctx
}

describe('LocalRepo sessions', () => {
  it('startSession pre-fills one set log per planned set, none done, with snapshots', async () => {
    const { repo, day } = await setup()
    const session = await repo.startSession(day.id)
    expect(session).toMatchObject({ plan_name: 'PPL', day_name: 'Push', completed_at: null, note: '' })
    const bench = session.exercises[0]
    expect(bench?.exercise_name).toBe('Bench Press')
    expect(bench?.sets).toHaveLength(3)
    for (const [i, s] of (bench?.sets ?? []).entries()) {
      expect(s).toMatchObject({ set_no: i + 1, target_reps: 5, target_weight: 95, actual_reps: 5, weight: 95, done: false })
    }
    expect(session.exercises).toHaveLength(2)
  })

  it('finish with all sets done progresses the item and completes the session', async () => {
    const { db, repo, day, benchItem } = await setupSingle()
    const session = await repo.startSession(day.id)
    for (const s of session.exercises[0]?.sets ?? []) await repo.updateSet(s.id, { done: true })
    const summary = await repo.finishSession(session.id)
    expect(summary).toEqual([
      {
        exercise_name: 'Bench Press',
        outcome: 'success',
        before: { reps: 5, weight: 95 },
        after: { reps: 5, weight: 100 },
      },
    ])
    expect((await db.planItems.get(benchItem.id))?.target_weight).toBe(100)
    expect((await repo.listSessions()).map((s) => s.id)).toEqual([session.id])
    expect(await repo.getActiveSession()).toBeUndefined()
    expect((await repo.getSession(session.id))?.completed_at).not.toBeNull()
    await expect(repo.finishSession(session.id)).rejects.toThrow()
  })

  it('persists across repo instances and blocks a second session', async () => {
    const { db, repo, day } = await setup()
    const session = await repo.startSession(day.id)
    const first = session.exercises[0]?.sets[0]
    if (!first) throw new Error('no set')
    await repo.updateSet(first.id, { done: true })
    const again = new LocalRepo(db)
    const active = await again.getActiveSession()
    expect(active?.id).toBe(session.id)
    expect(active?.exercises[0]?.sets[0]?.done).toBe(true)
    await expect(again.startSession(day.id)).rejects.toBeInstanceOf(SessionInProgressError)
  })

  it('finish survives deleted items and plan; they are skipped', async () => {
    const { repo, plan, day, benchItem, otherItem } = await setup()
    const session = await repo.startSession(day.id)
    for (const ex of session.exercises) for (const s of ex.sets) await repo.updateSet(s.id, { done: true })
    await repo.deletePlanItem(benchItem.id)
    await repo.deletePlan(plan.id)
    const summary = await repo.finishSession(session.id)
    expect(summary).toHaveLength(2)
    expect(summary.every((s) => s.outcome === 'skipped')).toBe(true)
    expect(summary[0]).toMatchObject({ exercise_name: 'Bench Press', before: { reps: 5, weight: 95 }, after: { reps: 5, weight: 95 } })
    const detail = await repo.getSession(session.id)
    expect(detail).toMatchObject({ plan_name: 'PPL', day_name: 'Push' })
    expect(detail?.exercises[0]?.exercise_name).toBe('Bench Press')
    expect(detail?.exercises.map((e) => e.plan_item_id)).toEqual([benchItem.id, otherItem.id])
  })

  it('discardSession removes the session and its set logs', async () => {
    const { db, repo, day } = await setup()
    const session = await repo.startSession(day.id)
    await repo.discardSession(session.id)
    expect(await db.sessions.count()).toBe(0)
    expect(await db.setLogs.count()).toBe(0)
    expect(await repo.getActiveSession()).toBeUndefined()
  })

  it('orders exercises by position snapshot, even after the plan is deleted', async () => {
    const { repo, plan, day, benchItem, otherItem } = await setup()
    await repo.move('item', otherItem.id, -1)
    const session = await repo.startSession(day.id)
    expect(session.exercises.map((e) => e.plan_item_id)).toEqual([otherItem.id, benchItem.id])
    await repo.deletePlan(plan.id)
    expect((await repo.getSession(session.id))?.exercises.map((e) => e.plan_item_id)).toEqual([
      otherItem.id,
      benchItem.id,
    ])
  })

  it('discardSession rejects a completed session', async () => {
    const { repo, day } = await setup()
    const session = await repo.startSession(day.id)
    await repo.finishSession(session.id)
    await expect(repo.discardSession(session.id)).rejects.toThrow()
    expect(await repo.getSession(session.id)).toBeDefined()
  })

  it('updateSet ignores undefined keys', async () => {
    const { repo, day } = await setup()
    const session = await repo.startSession(day.id)
    const set = session.exercises[0]?.sets[0]
    if (!set) throw new Error('no set')
    const updated = await repo.updateSet(set.id, { done: undefined, actual_reps: 4 })
    expect(updated).toMatchObject({ done: false, actual_reps: 4 })
  })

  it('updateSet validates input; updateSessionNote stores the note', async () => {
    const { repo, day } = await setup()
    const session = await repo.startSession(day.id)
    const set = session.exercises[0]?.sets[0]
    if (!set) throw new Error('no set')
    await expect(repo.updateSet(set.id, { actual_reps: -1 })).rejects.toThrow()
    await expect(repo.updateSet(set.id, { actual_reps: 1.5 })).rejects.toThrow()
    await expect(repo.updateSet(set.id, { weight: -5 })).rejects.toThrow()
    const updated = await repo.updateSet(set.id, { actual_reps: 4, weight: 90, note: 'grindy' })
    expect(updated).toMatchObject({ actual_reps: 4, weight: 90, note: 'grindy' })
    await repo.updateSessionNote(session.id, 'good day')
    expect((await repo.getSession(session.id))?.note).toBe('good day')
  })
})

describe('LocalRepo units and export', () => {
  it('updateProfile converts every stored weight and resets the increment', async () => {
    const { db, repo, bench, benchItem, day } = await setupSingle()
    await db.exercises.update(bench.id, { default_weight: 135 })
    await repo.updatePlanItem(benchItem.id, { weight: null })
    await db.planItems.update(benchItem.id, { target_weight: 140 })
    const session = await repo.startSession(day.id)
    const set = session.exercises[0]?.sets[0]
    if (!set) throw new Error('no set')
    await repo.updateSet(set.id, { done: true })
    await repo.finishSession(session.id)
    // finish progressed target to 145; reset it to the scenario value
    await db.planItems.update(benchItem.id, { target_weight: 140 })
    await db.setLogs.update(set.id, { weight: 135, target_weight: 140 })

    const profile = await repo.updateProfile({ units: 'kg' })
    expect(profile).toMatchObject({ units: 'kg', weight_increment: 2.5 })
    expect((await db.exercises.get(bench.id))?.default_weight).toBe(61.2)
    expect((await db.planItems.get(benchItem.id))?.target_weight).toBe(63.5)
    expect((await db.setLogs.get(set.id))?.weight).toBe(61.2)
    expect((await db.setLogs.get(set.id))?.target_weight).toBe(63.5)
    expect((await db.planItems.get(benchItem.id))?.weight).toBeNull()

    await repo.updateProfile({ units: 'kg' })
    expect((await db.exercises.get(bench.id))?.default_weight).toBe(61.2)
  })

  it('unit change converts progression rules and bumps updated_at', async () => {
    const { db, repo, benchItem, otherItem } = await setup()
    await repo.setRule(otherItem.id, { ...defaultRule(5), success_amount: 10 })
    const first = (await db.exercises.toArray())[0]
    if (!first) throw new Error('seed missing')
    await db.exercises.update(first.id, { updated_at: '2020-01-01T00:00:00.000Z' })
    await repo.updateProfile({ units: 'kg' })
    expect((await db.rules.get(benchItem.id))?.success_amount).toBe(2.5)
    expect((await db.rules.get(otherItem.id))?.success_amount).toBe(5)
    expect((await db.exercises.get(first.id))?.updated_at).not.toBe('2020-01-01T00:00:00.000Z')
  })

  it('add_reps rules are not converted', async () => {
    const { db, repo, benchItem } = await setup()
    await repo.setRule(benchItem.id, { ...defaultRule(5), success_action: 'add_reps', success_amount: 1, rep_ceiling: 12 })
    await repo.updateProfile({ units: 'kg' })
    expect((await db.rules.get(benchItem.id))?.success_amount).toBe(1)
  })

  it('weight_increment alone is set and validated', async () => {
    const { repo } = await setup()
    expect((await repo.updateProfile({ weight_increment: 1.25 })).weight_increment).toBe(1.25)
    await expect(repo.updateProfile({ weight_increment: 0 })).rejects.toThrow()
  })

  it('exportAll returns every table including deleted rows and round-trips JSON', async () => {
    const { repo, plan, day } = await setup()
    const session = await repo.startSession(day.id)
    await repo.deletePlan(plan.id)
    const data = await repo.exportAll()
    expect(data.version).toBe(1)
    expect(data.profile.units).toBe('lb')
    expect(data.plans.map((p) => p.id)).toContain(plan.id)
    expect(data.plan_items).toHaveLength(2)
    expect(data.progression_rules).toHaveLength(2)
    expect(data.item_states).toHaveLength(2)
    expect(data.workout_sessions.map((s) => s.id)).toEqual([session.id])
    expect(data.set_logs.length).toBeGreaterThan(0)
    expect(data.gear.length).toBeGreaterThan(0)
    expect(JSON.parse(JSON.stringify(data))).toEqual(data)
  })

  it('finish with zero sets done leaves item targets and state untouched (default edits still flow through)', async () => {
    const { db, repo, bench, plan, day } = await setup()
    const item2 = await repo.addPlanItem(day.id, bench.id)
    const session = await repo.startSession(day.id)
    const summary = await repo.finishSession(session.id)
    expect(summary.every((r) => r.outcome === 'skipped')).toBe(true)
    expect((await db.planItems.get(item2.id))?.target_reps).toBeNull()
    expect((await db.planItems.get(item2.id))?.target_weight).toBeNull()
    await repo.saveExercise({ ...bench, default_weight: 77 })
    const item = (await repo.getPlan(plan.id))!.days[0]!.items.find((i) => i.id === item2.id)!
    expect(item.effective.targetWeight).toBe(77)
  })

  it('finish of a rule-less item with sets done does not write targets', async () => {
    const { db, repo, bench, plan, day } = await setup()
    const item2 = await repo.addPlanItem(day.id, bench.id)
    await repo.setRule(item2.id, null)
    const session = await repo.startSession(day.id)
    for (const g of session.exercises.filter((e) => e.plan_item_id === item2.id))
      for (const st of g.sets) await repo.updateSet(st.id, { done: true })
    await repo.finishSession(session.id)
    expect((await db.planItems.get(item2.id))?.target_weight).toBeNull()
    await repo.saveExercise({ ...bench, default_weight: 77 })
    const item = (await repo.getPlan(plan.id))!.days[0]!.items.find((i) => i.id === item2.id)!
    expect(item.effective.targetWeight).toBe(77)
  })
})
