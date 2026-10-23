import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import {
  AlreadyHasDataError,
  ImportInvalidError,
  NotFoundError,
  SessionInProgressError,
  newId,
} from '@workout/shared'
import type { ExportData } from '@workout/shared'
import type { AnyPgColumn, AnyPgTable } from 'drizzle-orm/pg-core'
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

async function makeUser(init = true) {
  const id = `u_${randomUUID()}`
  await h.db.insert(t.user).values({ id, name: id, email: `${id}@example.test` })
  const s = createService(h.db, id)
  if (init) await s.init()
  return { id, s }
}

/** A user with a plan (2 items, rules), one finished session and one active session. */
async function populated() {
  const u = await makeUser()
  const [bench, squat] = (await u.s.listExercises()).filter((e) => ['Bench Press', 'Back Squat'].includes(e.name))
  const plan = await u.s.savePlan({ name: 'Strength' })
  const day = await u.s.savePlanDay({ plan_id: plan.id, name: 'Day 1' })
  const i1 = await u.s.addPlanItem(day.id, bench!.id)
  const i2 = await u.s.addPlanItem(day.id, squat!.id)
  await u.s.updatePlanItem(i1.id, { sets: 1 })
  const first = await u.s.startSession(day.id)
  for (const e of first.exercises) for (const set of e.sets) await u.s.updateSet(set.id, { done: true })
  await u.s.finishSession(first.id)
  const active = await u.s.startSession(day.id)
  const dropped = await u.s.savePlan({ name: 'Dropped' })
  await u.s.deletePlan(dropped.id)
  return { ...u, plan, day, i1, i2, active }
}

type Owned = AnyPgTable & { userId: AnyPgColumn }
const counts = async (userId: string) => {
  const q = async (table: Owned) => (await h.db.select().from(table).where(eq(table.userId, userId))).length
  return {
    profile: await q(t.profile),
    gear: await q(t.gear),
    exercise: await q(t.exercise),
    plan: await q(t.plan),
    planDay: await q(t.planDay),
    planItem: await q(t.planItem),
    rule: await q(t.progressionRule),
    state: await q(t.itemState),
    session: await q(t.workoutSession),
    setLog: await q(t.setLog),
  }
}

describe('startSession concurrency', () => {
  it('two simultaneous starts yield exactly one session', async () => {
    const other = await makeUser()
    const plan = await other.s.savePlan({ name: 'P' })
    const day = await other.s.savePlanDay({ plan_id: plan.id, name: 'D' })
    const ex = (await other.s.listExercises())[0]!
    await other.s.addPlanItem(day.id, ex.id)
    const results = await Promise.allSettled([other.s.startSession(day.id), createService(h.db, other.id).startSession(day.id)])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(failed.reason).toBeInstanceOf(SessionInProgressError)
    const sessions = await h.db.select().from(t.workoutSession).where(eq(t.workoutSession.userId, other.id))
    expect(sessions).toHaveLength(1)
    // the winner's sets are intact (the loser's rollback left nothing behind)
    const sets = await h.db.select().from(t.setLog).where(eq(t.setLog.userId, other.id))
    expect(sets.every((r) => r.sessionId === sessions[0]!.id)).toBe(true)
  })
})

describe('importAll', () => {
  it('reproduces the export in a fresh account: ids kept, owner rewritten, soft-deleted kept, no seeds', async () => {
    const src = await populated()
    const data = await src.s.exportAll()
    expect(data.plans.some((p) => p.deleted_at !== null)).toBe(true)
    const dst = await makeUser(false)
    await dst.s.importAll(data)
    const copy = await dst.s.exportAll()
    const strip = (d: ExportData) =>
      JSON.parse(JSON.stringify({ ...d, exported_at: undefined }, (k, v: unknown) => (k === 'user_id' ? undefined : v)))
    const sorted = (d: ExportData) => {
      const x = strip(d)
      for (const k of Object.keys(x)) if (Array.isArray(x[k])) x[k].sort((a: any, b: any) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
      return x
    }
    expect(sorted(copy)).toEqual(sorted(data))
    expect(copy.profile.user_id).toBe(dst.id)
    expect(copy.gear.every((g) => g.user_id === dst.id)).toBe(true)
    expect(await dst.s.listExercises()).toHaveLength(16)
    expect(await dst.s.listGear()).toHaveLength(8)
  })

  it('lands under the caller even when the file carries another user\'s user_id', async () => {
    const src = await populated()
    const data = await src.s.exportAll()
    const stranger = await makeUser()
    const forged = JSON.parse(JSON.stringify(data)) as ExportData
    forged.profile.user_id = stranger.id
    for (const g of forged.gear) g.user_id = stranger.id
    for (const e of forged.exercises) e.user_id = stranger.id
    const before = await counts(stranger.id)
    const dst = await makeUser(false)
    await dst.s.importAll(forged)
    expect((await dst.s.getProfile()).user_id).toBe(dst.id)
    expect(await counts(stranger.id)).toEqual(before)
    expect((await counts(dst.id)).gear).toBe(data.gear.length)
  })

  it('is all-or-nothing when the database rejects the last row, and a retry with a fixed file succeeds', async () => {
    const src = await populated()
    const good = await src.s.exportAll()
    const bad = JSON.parse(JSON.stringify(good)) as ExportData
    // passes the shared schema and the in-memory checks, fails only inside Postgres (NUL in text),
    // on the very last table written, after every earlier table was inserted
    bad.set_logs[bad.set_logs.length - 1]!.note = 'a\u0000b'
    const dst = await makeUser(false)
    await expect(dst.s.importAll(bad)).rejects.toBeInstanceOf(ImportInvalidError)
    expect(Object.values(await counts(dst.id)).every((n) => n === 0)).toBe(true)

    await dst.s.importAll(good)
    expect(await counts(dst.id)).toMatchObject({ profile: 1, setLog: good.set_logs.length, session: good.workout_sessions.length })
  })

  it('rejects an account that already has a profile and changes nothing', async () => {
    const src = await populated()
    const data = await src.s.exportAll()
    const dst = await makeUser()
    const before = await counts(dst.id)
    await expect(dst.s.importAll(data)).rejects.toBeInstanceOf(AlreadyHasDataError)
    expect(await counts(dst.id)).toEqual(before)
  })

  it('rejects dangling references with ImportInvalidError and writes nothing', async () => {
    const src = await populated()
    const good = await src.s.exportAll()
    const dst = await makeUser(false)
    const mutate = (fn: (d: ExportData) => void) => {
      const d = JSON.parse(JSON.stringify(good)) as ExportData
      fn(d)
      return d
    }
    const cases: ExportData[] = [
      mutate((d) => (d.set_logs[0]!.session_id = newId())),
      mutate((d) => (d.plan_items[0]!.plan_day_id = newId())),
      mutate((d) => (d.plan_items[0]!.exercise_id = newId())),
      mutate((d) => (d.plan_days[0]!.plan_id = newId())),
      mutate((d) => (d.progression_rules[0]!.plan_item_id = newId())),
      mutate((d) => (d.item_states[0]!.plan_item_id = newId())),
      mutate((d) => (d.plans[0]!.id = 'not-a-uuid')),
      mutate((d) => d.plans.push({ ...d.plans[0]! })),
    ]
    for (const bad of cases) await expect(dst.s.importAll(bad)).rejects.toBeInstanceOf(ImportInvalidError)
    await expect(dst.s.importAll({ ...good, version: 2 } as unknown as ExportData)).rejects.toBeInstanceOf(ImportInvalidError)
    expect(Object.values(await counts(dst.id)).every((n) => n === 0)).toBe(true)
  })
})

describe('updateSet last write wins', () => {
  async function oneSet() {
    const u = await populated()
    const set = u.active.exercises[0]!.sets[0]!
    return { ...u, set }
  }

  it('ignores an older updated_at, applies a newer one, and is idempotent', async () => {
    const { s, set } = await oneSet()
    const base = Date.parse(set.updated_at)
    const iso = (ms: number) => new Date(base + ms).toISOString()
    const newer = await s.updateSet(set.id, { actual_reps: 7, updated_at: iso(10_000) })
    expect(newer).toMatchObject({ actual_reps: 7, updated_at: iso(10_000) })
    const stale = await s.updateSet(set.id, { actual_reps: 1, done: true, updated_at: iso(5_000) })
    expect(stale).toEqual(newer)
    expect(await s.updateSet(set.id, { actual_reps: 7, updated_at: iso(10_000) })).toEqual(newer)
    // no updated_at: always applies, stamped with the server clock
    const live = await s.updateSet(set.id, { note: 'x' })
    expect(live.note).toBe('x')
    expect(Date.parse(live.updated_at)).toBeLessThanOrEqual(Date.now())
  })

  it('converges to the newest write when replays arrive out of order', async () => {
    const { s, set } = await oneSet()
    const t0 = Date.now() + 60_000
    const ops = [
      { actual_reps: 3, updated_at: new Date(t0 + 1).toISOString() },
      { actual_reps: 4, updated_at: new Date(t0 + 2).toISOString() },
      { actual_reps: 5, updated_at: new Date(t0 + 3).toISOString() },
    ]
    for (const op of [ops[2]!, ops[0]!, ops[1]!, ops[2]!, ops[0]!]) await s.updateSet(set.id, op)
    const final = (await s.getActiveSession())!.exercises[0]!.sets[0]!
    expect(final.actual_reps).toBe(5)
  })

  it('still validates a stale patch', async () => {
    const { s, set } = await oneSet()
    await expect(s.updateSet(set.id, { actual_reps: -1, updated_at: new Date(0).toISOString() })).rejects.toThrow()
  })
})

describe('finishSession with a deleted exercise', () => {
  it("reports 'skipped' for the deleted item and still progresses the other", async () => {
    const u = await populated()
    for (const e of u.active.exercises) for (const set of e.sets) await u.s.updateSet(set.id, { done: true })
    const squatName = u.active.exercises.find((e) => e.plan_item_id === u.i2.id)!.exercise_name
    const benchName = u.active.exercises.find((e) => e.plan_item_id === u.i1.id)!
    await u.s.deleteExercise(u.i2.exercise_id)
    const summary = await u.s.finishSession(u.active.id)
    expect(summary.find((r) => r.exercise_name === squatName)).toMatchObject({ outcome: 'skipped' })
    const bench = summary.find((r) => r.exercise_name === benchName.exercise_name)!
    expect(bench.outcome).toBe('success')
    expect(bench.after.weight).toBeGreaterThan(bench.before.weight)
    expect((await u.s.getSession(u.active.id))!.completed_at).not.toBeNull()
    const detail = await u.s.getSession(u.active.id)
    expect(detail!.exercises.find((e) => e.plan_item_id === u.i2.id)?.notes).toBeDefined()
    await expect(u.s.finishSession(u.active.id)).rejects.toThrow(/already completed/)
  })
})

describe('discardSession', () => {
  it('removes an unfinished session and its sets, rejects a finished one, ignores unknown ids', async () => {
    const u = await populated()
    const finished = (await u.s.listSessions())[0]!
    await expect(u.s.discardSession(finished.id)).rejects.toThrow()
    expect(await u.s.getSession(finished.id)).toBeDefined()
    await u.s.discardSession(u.active.id)
    expect(await u.s.getActiveSession()).toBeUndefined()
    expect(await h.db.select().from(t.setLog).where(eq(t.setLog.sessionId, u.active.id))).toHaveLength(0)
    await u.s.discardSession(newId())
    await u.s.discardSession('not-a-uuid')
  })
})

describe('session isolation between users', () => {
  it('user B cannot start, update, finish, read or discard user A sessions', async () => {
    const a = await populated()
    const b = await makeUser()
    const before = await a.s.exportAll()
    const set = a.active.exercises[0]!.sets[0]!

    await expect(b.s.startSession(a.day.id)).rejects.toBeInstanceOf(NotFoundError)
    await expect(b.s.updateSet(set.id, { done: true, actual_reps: 99 })).rejects.toBeInstanceOf(NotFoundError)
    await expect(b.s.updateSessionNote(a.active.id, 'hax')).rejects.toBeInstanceOf(NotFoundError)
    await expect(b.s.finishSession(a.active.id)).rejects.toBeInstanceOf(NotFoundError)
    expect(await b.s.getSession(a.active.id)).toBeUndefined()
    expect(await b.s.getActiveSession()).toBeUndefined()
    expect(await b.s.listSessions()).toEqual([])
    await b.s.discardSession(a.active.id)

    const after = await a.s.exportAll()
    expect({ ...after, exported_at: '' }).toEqual({ ...before, exported_at: '' })
    expect((await b.s.exportAll()).workout_sessions).toEqual([])
  })
})
