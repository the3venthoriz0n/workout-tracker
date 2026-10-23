import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as t from '../src/db/schema.js'
import { type TestDb, withTestDb } from './harness.js'

let h: TestDb
beforeEach(async () => {
  h = await withTestDb()
})
afterEach(async () => {
  await h?.cleanup()
})

const now = new Date()
let n = 0
async function makeUser() {
  const id = `u${++n}_${randomUUID()}`
  await h.db.insert(t.user).values({ id, name: id, email: `${id}@example.test` })
  return id
}
const uuid = () => randomUUID()

// Drizzle wraps driver errors; the Postgres error (with the constraint name) is in `cause`.
async function violates(p: PromiseLike<unknown>, constraint: string) {
  try {
    await p
  } catch (err) {
    const cause = (err as { cause?: { constraint_name?: string } }).cause
    expect(cause?.constraint_name).toBe(constraint)
    return
  }
  expect.fail(`expected a violation of ${constraint}`)
}

// Insert a full object graph for one user and return its ids.
async function seedGraph(userId: string) {
  const ids = {
    gear: uuid(), exercise: uuid(), plan: uuid(), day: uuid(),
    item: uuid(), session: uuid(), set: uuid(),
  }
  const { db } = h
  await db.insert(t.profile).values({ userId, weightIncrement: '5' })
  await db.insert(t.gear).values({ id: ids.gear, userId, name: 'Barbell' })
  await db.insert(t.exercise).values({
    id: ids.exercise, userId, name: 'Squat', defaultSets: 3, defaultReps: 5, defaultWeight: '45',
  })
  await db.insert(t.plan).values({ id: ids.plan, userId, name: 'P' })
  await db.insert(t.planDay).values({ id: ids.day, userId, planId: ids.plan, name: 'D', position: 0 })
  await db.insert(t.planItem).values({
    id: ids.item, userId, planDayId: ids.day, exerciseId: ids.exercise, position: 0,
  })
  await db.insert(t.progressionRule).values({
    userId, planItemId: ids.item, successAction: 'add_weight', successAmount: '5',
    failStreakLimit: 3, deloadPct: '10',
  })
  await db.insert(t.itemState).values({ userId, planItemId: ids.item })
  await db.insert(t.workoutSession).values({
    id: ids.session, userId, planDayId: ids.day, planName: 'P', dayName: 'D', startedAt: now,
  })
  await db.insert(t.setLog).values({
    id: ids.set, userId, sessionId: ids.session, planItemId: ids.item, exerciseId: ids.exercise,
    exerciseName: 'Squat', setNo: 1, position: 0, targetReps: 5, targetWeight: '45',
    actualReps: 0, weight: '45',
  })
  return ids
}

describe('schema', () => {
  it('lets two users use the same id (composite primary key)', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const id = uuid()
    await h.db.insert(t.gear).values({ id, userId: a, name: 'Bar' })
    await h.db.insert(t.gear).values({ id, userId: b, name: 'Bar' })
    // ...but not twice for the same user
    await violates(h.db.insert(t.gear).values({ id, userId: a, name: 'Dup' }), 'gear_user_id_id_pk')
    const rows = await h.db.select().from(t.gear).where(eq(t.gear.id, id))
    expect(rows).toHaveLength(2)
  })

  it("rejects a plan_item whose plan_day belongs to another user (composite FK)", async () => {
    const a = await makeUser()
    const b = await makeUser()
    const ga = await seedGraph(a)
    const exB = uuid()
    await h.db.insert(t.exercise).values({
      id: exB, userId: b, name: 'X', defaultSets: 1, defaultReps: 1, defaultWeight: '0',
    })
    await violates(
      h.db.insert(t.planItem).values({
        id: uuid(), userId: b, planDayId: ga.day, exerciseId: exB, position: 0,
      }),
      'plan_item_plan_day_fk',
    )
    // And an exercise owned by another user is rejected too.
    const dayB = uuid()
    const planB = uuid()
    await h.db.insert(t.plan).values({ id: planB, userId: b, name: 'PB' })
    await h.db.insert(t.planDay).values({ id: dayB, userId: b, planId: planB, name: 'DB', position: 0 })
    await violates(
      h.db.insert(t.planItem).values({
        id: uuid(), userId: b, planDayId: dayB, exerciseId: ga.exercise, position: 0,
      }),
      'plan_item_exercise_fk',
    )
  })

  it('allows one active workout_session per user; completed or deleted ones do not count', async () => {
    const a = await makeUser()
    const b = await makeUser()
    const start = (userId: string, extra: Partial<typeof t.workoutSession.$inferInsert> = {}) =>
      h.db.insert(t.workoutSession).values({
        id: uuid(), userId, planDayId: uuid(), planName: 'P', dayName: 'D', startedAt: now, ...extra,
      })
    await start(a)
    await violates(start(a), 'workout_session_one_active_idx')
    await start(b) // another user is fine
    await start(a, { completedAt: now }) // completed does not count
    await start(a, { deletedAt: now }) // deleted does not count
    await h.db
      .update(t.workoutSession)
      .set({ completedAt: now })
      .where(eq(t.workoutSession.userId, a))
    await start(a) // the old active one is finished, so a new one may start
  })

  it('cascades a user delete to every domain table', async () => {
    const a = await makeUser()
    const b = await makeUser()
    await seedGraph(a)
    await seedGraph(b)
    await h.db.delete(t.user).where(eq(t.user.id, a))
    const tables = [
      t.profile, t.gear, t.exercise, t.plan, t.planDay, t.planItem,
      t.progressionRule, t.itemState, t.workoutSession, t.setLog,
    ]
    for (const table of tables) {
      const [mine] = await h.db.select({ c: sql<number>`count(*)::int` }).from(table).where(eq(table.userId, a))
      const [theirs] = await h.db.select({ c: sql<number>`count(*)::int` }).from(table).where(eq(table.userId, b))
      expect(mine?.c).toBe(0)
      expect(theirs?.c).toBe(1)
    }
  })

  it('round-trips numeric weights', async () => {
    const a = await makeUser()
    const id = uuid()
    await h.db.insert(t.exercise).values({
      id, userId: a, name: 'Bench', defaultSets: 3, defaultReps: 8, defaultWeight: String(62.5),
    })
    const [row] = await h.db.select().from(t.exercise).where(eq(t.exercise.id, id))
    // Drizzle returns numeric as a string; the service layer converts.
    expect(Number(row?.defaultWeight)).toBe(62.5)
  })

  it('round-trips required_gear_ids (uuid[]) and default_rule (jsonb)', async () => {
    const a = await makeUser()
    const gearIds = [uuid(), uuid()]
    const exId = uuid()
    await h.db.insert(t.exercise).values({
      id: exId, userId: a, name: 'Row', requiredGearIds: gearIds,
      defaultSets: 3, defaultReps: 8, defaultWeight: '0',
    })
    const rule = {
      success_action: 'add_weight' as const, success_amount: 2.5, fail_streak_limit: 3,
      deload_pct: 10, rep_ceiling: null,
    }
    await h.db.insert(t.profile).values({ userId: a, weightIncrement: '2.5', defaultRule: rule })
    const [ex] = await h.db.select().from(t.exercise).where(eq(t.exercise.id, exId))
    const [pr] = await h.db.select().from(t.profile).where(eq(t.profile.userId, a))
    expect(ex?.requiredGearIds).toEqual(gearIds)
    expect(pr?.defaultRule).toEqual(rule)
    // Defaults: empty array, null rule
    const b = await makeUser()
    const ex2 = uuid()
    await h.db.insert(t.exercise).values({
      id: ex2, userId: b, name: 'E', defaultSets: 1, defaultReps: 1, defaultWeight: '0',
    })
    const [e2] = await h.db.select().from(t.exercise).where(eq(t.exercise.id, ex2))
    expect(e2?.requiredGearIds).toEqual([])
  })
})
