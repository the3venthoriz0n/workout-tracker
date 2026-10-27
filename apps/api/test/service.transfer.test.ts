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
import { HasPublishedError } from '../src/service/transfer.js'
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
  // Item overrides, so the export has rule rows (new items inherit and have none).
  await u.s.setRule(i1.id, { success_action: 'add_weight', success_amount: 5, fail_streak_limit: 3, deload_pct: 10, rep_ceiling: null })
  await u.s.setRule(i2.id, { success_action: 'add_weight', success_amount: 5, fail_streak_limit: 3, deload_pct: 10, rep_ceiling: null })
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
      // `account` is the exporting account itself (email), which is never imported.
      JSON.parse(JSON.stringify({ ...d, exported_at: undefined, account: undefined }, (k, v: unknown) => (k === 'user_id' ? undefined : v)))
    const sorted = (d: ExportData) => {
      const x = strip(d)
      for (const k of Object.keys(x)) if (Array.isArray(x[k])) x[k].sort((a: any, b: any) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
      return x
    }
    expect(sorted(copy)).toEqual(sorted(data))
    expect(copy.account?.email).toBe(`${dst.id}@example.test`)
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

describe('imports written before day colours, angle, AMRAP, supersets and layered rules', () => {
  const NEW_FIELDS: Record<string, string[]> = {
    plan_days: ['color'],
    exercises: ['supports_angle', 'default_rule'],
    plan_items: ['angle', 'amrap_last', 'superset_group', 'inherit_rule'],
    set_logs: ['angle', 'amrap', 'seq', 'superset_group', 'superset_label'],
  }
  const strip = (data: ExportData): unknown => {
    const out: Record<string, unknown> = { ...data }
    for (const [table, keys] of Object.entries(NEW_FIELDS)) {
      out[table] = (data[table as keyof ExportData] as Record<string, unknown>[]).map((row) =>
        Object.fromEntries(Object.entries(row).filter(([k]) => !keys.includes(k))),
      )
    }
    return out
  }

  it('still imports, with defaults that keep the old meaning (no rule row = no progression)', async () => {
    const src = await populated()
    // As the previous release stored them: every item had its own rule row unless the user chose
    // "no progression", which deleted it.
    await src.s.setRule(src.i1.id, { success_action: 'add_weight', success_amount: 10, fail_streak_limit: 3, deload_pct: 10, rep_ceiling: null })
    await src.s.setRule(src.i2.id, null)
    const old = strip(await src.s.exportAll()) as ExportData
    expect(Object.keys(old.plan_items[0]!)).not.toContain('inherit_rule')
    const dst = await makeUser(false)
    await dst.s.importAll(old)
    const tree = await dst.s.getPlan(src.plan.id)
    expect(tree?.days[0]?.color).toBeNull()
    expect(tree?.days[0]?.items.map((i) => [i.ruleSource, i.rule?.success_amount ?? null, i.inherit_rule, i.superset_group])).toEqual([
      ['item', 10, false, null],
      ['item', null, false, null],
    ])
    const logs = (await dst.s.exportAll()).set_logs
    expect(logs.every((l) => l.seq === null && l.amrap === false && l.superset_label === null)).toBe(true)
  })

  it('clears a one-member superset on import and rejects one that spans days', async () => {
    const src = await populated()
    const data = await src.s.exportAll()
    const g = newId()
    const spread = structuredClone(data)
    spread.plan_items[0]!.superset_group = g
    const lonely = await makeUser(false)
    await lonely.s.importAll(spread)
    expect((await lonely.s.exportAll()).plan_items.every((i) => i.superset_group === null)).toBe(true)
    const day2 = { ...spread.plan_days[0]!, id: newId(), position: 1 }
    const across = structuredClone(spread)
    across.plan_days.push(day2)
    across.plan_items[1]!.superset_group = g
    across.plan_items[1]!.plan_day_id = day2.id
    const other = await makeUser(false)
    await expect(other.s.importAll(across)).rejects.toBeInstanceOf(ImportInvalidError)
  })
})

describe('replaceAll (restore from a file)', () => {
  /** Every row of the user in every domain table, plus the community rows that must not move. */
  const state = async (userId: string) => {
    const s = createService(h.db, userId)
    const { exported_at: _t, ...rest } = await s.exportAll()
    return JSON.stringify(rest)
  }
  const listingCounts = async (id: string) => {
    const [row] = await h.db.select({ up: t.sharedPlan.upvoteCount, down: t.sharedPlan.downloadCount }).from(t.sharedPlan).where(eq(t.sharedPlan.id, id))
    return row
  }
  /** A user with a published listing of their plan. */
  async function publisher() {
    const u = await populated()
    await u.s.updateProfile({ display_name: 'Pat Lifts' })
    const { shared_plan_id } = await u.s.publishPlan(u.plan.id, { title: 'Pat plan' })
    return { ...u, listing: shared_plan_id }
  }

  it('replaces every domain row, keeps the profile row, ignores account and community fields', async () => {
    const src = await populated()
    const data = await src.s.exportAll()
    const dst = await populated()
    const before = await counts(dst.id)
    expect(before.plan).toBeGreaterThan(0)
    const withExtras = {
      ...data,
      account: { email: 'someone@example.test', created_at: data.exported_at },
      community: { listings: [], votes: [{ shared_plan_id: newId(), created_at: data.exported_at }], downloads: [] },
    }
    await dst.s.replaceAll(withExtras)
    const after = await dst.s.exportAll()
    expect(after.plans.map((p) => p.id).sort()).toEqual(data.plans.map((p) => p.id).sort())
    expect(after.set_logs).toHaveLength(data.set_logs.length)
    expect(after.profile.user_id).toBe(dst.id)
    expect(await counts(dst.id)).toMatchObject({ profile: 1, plan: data.plans.length, setLog: data.set_logs.length })
    expect(after.community?.votes).toEqual([])
    const [u] = await h.db.select({ email: t.user.email }).from(t.user).where(eq(t.user.id, dst.id))
    expect(u?.email).toBe(`${dst.id}@example.test`)
  })

  it("leaves other users' data byte-identical", async () => {
    const other = await publisher()
    const bystander = await populated()
    const beforeOther = await state(other.id)
    const beforeBystander = await state(bystander.id)
    const dst = await populated()
    // The file is full of the other user's ids: they land under the caller only (composite keys).
    const data = await other.s.exportAll()
    await dst.s.replaceAll({ ...data, community: undefined })
    expect(await state(other.id)).toBe(beforeOther)
    expect(await state(bystander.id)).toBe(beforeBystander)
  })

  it('refuses with HasPublishedError while a listing is published, and changes nothing', async () => {
    const p = await publisher()
    const data = await (await populated()).s.exportAll()
    const before = await state(p.id)
    await expect(p.s.replaceAll(data)).rejects.toBeInstanceOf(HasPublishedError)
    expect(await state(p.id)).toBe(before)
    // After unpublishing it works; the (unpublished) listing row stays with its counters.
    await p.s.unpublishPlan(p.plan.id)
    const listingBefore = await listingCounts(p.listing)
    await p.s.replaceAll(data)
    expect(await listingCounts(p.listing)).toEqual(listingBefore)
    expect((await p.s.listMyShared()).map((l) => l.id)).toEqual([p.listing])
  })

  it('leaves votes, downloads and listing counters untouched', async () => {
    const p = await publisher()
    const fan = await populated()
    await fan.s.setVote(p.listing, true)
    await fan.s.adoptSharedPlan({ shared_plan_id: p.listing })
    const countersBefore = await listingCounts(p.listing)
    expect(countersBefore).toEqual({ up: 1, down: 1 })
    const votesBefore = await h.db.select().from(t.planVote).where(eq(t.planVote.userId, fan.id))
    const downloadsBefore = await h.db.select().from(t.planDownload).where(eq(t.planDownload.userId, fan.id))
    await fan.s.replaceAll(await (await populated()).s.exportAll())
    expect(await listingCounts(p.listing)).toEqual(countersBefore)
    expect(await h.db.select().from(t.planVote).where(eq(t.planVote.userId, fan.id))).toEqual(votesBefore)
    expect(await h.db.select().from(t.planDownload).where(eq(t.planDownload.userId, fan.id))).toEqual(downloadsBefore)
    expect(await fan.s.hasVoted(p.listing)).toBe(true)
  })

  it('is all-or-nothing when the database rejects the last row (after every delete ran)', async () => {
    const src = await populated()
    const bad = JSON.parse(JSON.stringify(await src.s.exportAll())) as ExportData
    // Passes the shared schema and checks, fails only inside Postgres on the last table written.
    bad.set_logs[bad.set_logs.length - 1]!.note = 'a\u0000b'
    const dst = await populated()
    const before = await state(dst.id)
    const beforeCounts = await counts(dst.id)
    await expect(dst.s.replaceAll(bad)).rejects.toBeInstanceOf(ImportInvalidError)
    expect(await state(dst.id)).toBe(before)
    expect(await counts(dst.id)).toEqual(beforeCounts)
  })

  it('rolls back on a failure that is not a bad file too (forced mid-transaction error)', async () => {
    const src = await populated()
    const data = await src.s.exportAll()
    const dst = await populated()
    const before = await state(dst.id)
    // A trigger that fails the first set_log insert of this user only: the deletes have run by then.
    await h.sql(`create function wt_fail_restore() returns trigger language plpgsql as $$
      begin if new.user_id = '${dst.id}' then raise exception 'forced failure'; end if; return new; end $$`)
    await h.sql('create trigger wt_fail_restore before insert on set_log for each row execute function wt_fail_restore()')
    try {
      await expect(dst.s.replaceAll(data)).rejects.toThrow()
    } finally {
      await h.sql('drop trigger wt_fail_restore on set_log')
      await h.sql('drop function wt_fail_restore()')
    }
    expect(await state(dst.id)).toBe(before)
  })

  it('rejects an invalid file before touching anything', async () => {
    const src = await populated()
    const good = await src.s.exportAll()
    const dst = await populated()
    const before = await state(dst.id)
    const bad = JSON.parse(JSON.stringify(good)) as ExportData
    bad.plan_items[0]!.exercise_id = newId()
    await expect(dst.s.replaceAll(bad)).rejects.toBeInstanceOf(ImportInvalidError)
    await expect(dst.s.replaceAll({ nope: true } as unknown as ExportData)).rejects.toBeInstanceOf(ImportInvalidError)
    expect(await state(dst.id)).toBe(before)
  })
})
