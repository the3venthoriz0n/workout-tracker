import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { ProfileNotFoundError, newId } from '@workout/shared'
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

async function makeUser() {
  const id = `u_${randomUUID()}`
  await h.db.insert(t.user).values({ id, name: id, email: `${id}@example.test` })
  return id
}
const rule = { success_action: 'add_weight' as const, success_amount: 5, fail_streak_limit: 3, deload_pct: 10, rep_ceiling: null }

describe('service profile and isolation', () => {
  it('concurrent init() calls yield one profile, 8 gear and 16 exercises', async () => {
    const userId = await makeUser()
    const s = createService(h.db, userId)
    await Promise.all([s.init(), s.init(), s.init(), createService(h.db, userId).init()])
    expect(await h.db.select().from(t.profile).where(eq(t.profile.userId, userId))).toHaveLength(1)
    expect(await s.listGear()).toHaveLength(8)
    expect(await s.listExercises()).toHaveLength(16)
  })

  it('getProfile() before init() throws ProfileNotFoundError', async () => {
    const s = createService(h.db, await makeUser())
    await expect(s.getProfile()).rejects.toBeInstanceOf(ProfileNotFoundError)
  })

  it('two users are independent even with the same client-generated ids', async () => {
    const a = createService(h.db, await makeUser())
    const b = createService(h.db, await makeUser())
    await a.init()
    await b.init()
    const id = newId()
    await a.saveGear({ id, name: 'Sled', owned: true })
    await b.saveGear({ id, name: 'Sled B', owned: false })
    expect((await a.listGear()).find((g) => g.id === id)?.name).toBe('Sled')
    expect((await b.listGear()).find((g) => g.id === id)?.name).toBe('Sled B')
    await a.deleteGear(id)
    expect((await a.listGear()).some((g) => g.id === id)).toBe(false)
    expect((await b.listGear()).find((g) => g.id === id)).toMatchObject({ name: 'Sled B', owned: false })
    expect(await b.listGear()).toHaveLength(9)
    // a foreign/unknown id is a no-op, not an error
    await b.deleteExercise(newId())
    expect((await a.getProfile()).user_id).not.toBe((await b.getProfile()).user_id)
    expect(await a.listExercises()).toHaveLength(16)
  })

  it('saveGear is idempotent and preserves created_at', async () => {
    const s = createService(h.db, await makeUser())
    await s.init()
    const id = newId()
    const first = await s.saveGear({ id, name: 'Rope', owned: true })
    const again = await s.saveGear({ id, name: 'Rope', owned: true })
    const renamed = await s.saveGear({ id, name: 'Rope 2', owned: true })
    expect(again.created_at).toBe(first.created_at)
    expect(renamed.created_at).toBe(first.created_at)
    expect(renamed.updated_at >= first.updated_at).toBe(true)
    expect((await s.listGear()).filter((g) => g.id === id)).toHaveLength(1)
  })

  it('saveExercise rejects non-http(s) video URLs', async () => {
    const s = createService(h.db, await makeUser())
    await s.init()
    const base = { name: 'X', notes: '', required_gear_ids: [], active: true, default_sets: 3, default_reps: 5, default_weight: 10 }
    await expect(s.saveExercise({ ...base, video_url: 'javascript:alert(1)' })).rejects.toThrow()
    await expect(s.saveExercise({ ...base, video_url: 'https://example.test/v' })).resolves.toMatchObject({
      video_url: 'https://example.test/v',
    })
  })

  it('numeric values round-trip as numbers', async () => {
    const s = createService(h.db, await makeUser())
    await s.init()
    const e = await s.saveExercise({
      name: 'Odd', notes: '', video_url: null, required_gear_ids: [], active: true,
      default_sets: 3, default_reps: 5, default_weight: 62.5,
    })
    expect(e.default_weight).toBe(62.5)
    const listed = (await s.listExercises()).find((x) => x.id === e.id)
    expect(listed?.default_weight).toBe(62.5)
    expect(typeof listed?.default_weight).toBe('number')
    const p = await s.updateProfile({ weight_increment: 0.1 + 0.2 })
    expect(typeof p.weight_increment).toBe('number')
    expect(p.weight_increment).toBe(0.3)
    const d = await s.updateProfile({ default_rule: { ...rule, success_amount: 1.25, deload_pct: 7.5 } })
    expect(d.default_rule).toMatchObject({ success_amount: 1.25, deload_pct: 7.5 })
  })

  it('updateProfile rejects a step <= 0 and a malformed default_rule', async () => {
    const s = createService(h.db, await makeUser())
    await s.init()
    await expect(s.updateProfile({ weight_increment: 0 })).rejects.toThrow()
    await expect(s.updateProfile({ weight_increment: -1 })).rejects.toThrow()
    await expect(s.updateProfile({ weight_increment: Number.NaN })).rejects.toThrow()
    await expect(
      s.updateProfile({ default_rule: { ...rule, success_amount: 0 } }),
    ).rejects.toThrow()
    await expect(
      s.updateProfile({ default_rule: { ...rule, success_action: 'nope' as never } }),
    ).rejects.toThrow()
    expect(await s.getProfile()).toMatchObject({ weight_increment: 5 })
    expect((await s.getProfile()).default_rule).toBeUndefined()
  })

  it('converts plan items, set logs, rule amounts and default_rule on a unit switch', async () => {
    const userId = await makeUser()
    const s = createService(h.db, userId)
    await s.init()
    await s.updateProfile({ default_rule: { ...rule, success_amount: 5 } })
    const ex = (await s.listExercises())[0]!
    const [plan, day, item, item2, session] = [newId(), newId(), newId(), newId(), newId()]
    const db = h.db
    await db.insert(t.plan).values({ id: plan, userId, name: 'P' })
    await db.insert(t.planDay).values({ id: day, userId, planId: plan, name: 'D', position: 0 })
    await db.insert(t.planItem).values([
      { id: item, userId, planDayId: day, exerciseId: ex.id, position: 0, weight: '135', targetWeight: '140' },
      { id: item2, userId, planDayId: day, exerciseId: ex.id, position: 1 },
    ])
    await db.insert(t.progressionRule).values([
      { userId, planItemId: item, successAction: 'add_weight', successAmount: '5', failStreakLimit: 3, deloadPct: '10' },
      { userId, planItemId: item2, successAction: 'add_reps', successAmount: '1', failStreakLimit: 3, deloadPct: '10' },
    ])
    await db.insert(t.workoutSession).values({
      id: session, userId, planDayId: day, planName: 'P', dayName: 'D', startedAt: new Date(),
    })
    await db.insert(t.setLog).values({
      id: newId(), userId, sessionId: session, planItemId: item, exerciseId: ex.id, exerciseName: ex.name,
      setNo: 1, position: 0, targetReps: 5, targetWeight: '135', actualReps: 5, weight: '135',
    })
    await s.updateProfile({ units: 'kg' })
    const [pi] = await db.select().from(t.planItem).where(eq(t.planItem.id, item))
    expect([Number(pi!.weight), Number(pi!.targetWeight)]).toEqual([61.2, 63.5])
    expect(pi!.reps).toBeNull()
    const [pi2] = await db.select().from(t.planItem).where(eq(t.planItem.id, item2))
    expect(pi2!.weight).toBeNull()
    const rules = await db.select().from(t.progressionRule).where(eq(t.progressionRule.userId, userId))
    expect(rules.map((r) => [r.successAction, Number(r.successAmount)]).sort()).toEqual([
      ['add_reps', 1],
      ['add_weight', 2.5],
    ])
    const [log] = await db.select().from(t.setLog).where(eq(t.setLog.userId, userId))
    expect([Number(log!.weight), Number(log!.targetWeight)]).toEqual([61.2, 61.2])
    expect((await s.getProfile()).default_rule?.success_amount).toBe(2.5)
  })

  it('a unit switch clamps values that would leave numeric(8,2) instead of failing', async () => {
    const userId = await makeUser()
    const s = createService(h.db, userId)
    await s.init()
    await s.updateProfile({ units: 'kg' })
    const ex = (await s.listExercises())[0]!
    const [plan, day, item] = [newId(), newId(), newId()]
    await h.db.insert(t.plan).values({ id: plan, userId, name: 'P' })
    await h.db.insert(t.planDay).values({ id: day, userId, planId: plan, name: 'D', position: 0 })
    await h.db.insert(t.planItem).values({
      id: item, userId, planDayId: day, exerciseId: ex.id, position: 0, weight: '90000',
    })
    // 500000 kg is ~1.1M lb, which numeric(8,2) cannot hold: the conversion clamps to 100000.
    await h.db.insert(t.progressionRule).values({
      userId, planItemId: item, successAction: 'add_weight', successAmount: '500000',
      failStreakLimit: 3, deloadPct: '10',
    })
    await s.updateProfile({ units: 'lb' })
    const [row] = await h.db.select().from(t.planItem).where(eq(t.planItem.id, item))
    expect(Number(row!.weight)).toBe(100000)
    const [rule] = await h.db.select().from(t.progressionRule).where(eq(t.progressionRule.planItemId, item))
    expect(Number(rule!.successAmount)).toBeLessThanOrEqual(100000)
    expect((await s.getProfile()).units).toBe('lb')
  })
})
