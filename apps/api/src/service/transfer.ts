import { asc, eq } from 'drizzle-orm'
import { AlreadyHasDataError, ImportInvalidError, LIMITS, ProfileNotFoundError, exportDataSchema } from '@workout/shared'
import type { ExportData } from '@workout/shared'
import {
  exercise,
  gear,
  itemState,
  plan,
  planDay,
  planItem,
  profile,
  progressionRule,
  setLog,
  workoutSession,
} from '../db/schema.js'
import type { Db } from '../db/types.js'
import {
  dec,
  isUuid,
  now,
  toExercise,
  toGear,
  toItemState,
  toPlan,
  toPlanDay,
  toPlanItem,
  toProfile,
  toRule,
  toSession,
  toSetLog,
} from './mappers.js'
import { pgCode } from './pg-error.js'

export async function exportAll(db: Db, userId: string): Promise<ExportData> {
  return db.transaction(
    async (tx) => {
      const [prof] = await tx.select().from(profile).where(eq(profile.userId, userId))
      if (!prof) throw new ProfileNotFoundError()
      // Every row, soft-deleted ones included; a stable order keeps exports diffable.
      const rows = {
        gear: await tx.select().from(gear).where(eq(gear.userId, userId)).orderBy(asc(gear.createdAt), asc(gear.id)),
        exercises: await tx.select().from(exercise).where(eq(exercise.userId, userId)).orderBy(asc(exercise.createdAt), asc(exercise.id)),
        plans: await tx.select().from(plan).where(eq(plan.userId, userId)).orderBy(asc(plan.createdAt), asc(plan.id)),
        days: await tx.select().from(planDay).where(eq(planDay.userId, userId)).orderBy(asc(planDay.createdAt), asc(planDay.id)),
        items: await tx.select().from(planItem).where(eq(planItem.userId, userId)).orderBy(asc(planItem.createdAt), asc(planItem.id)),
        rules: await tx.select().from(progressionRule).where(eq(progressionRule.userId, userId)).orderBy(asc(progressionRule.createdAt), asc(progressionRule.planItemId)),
        states: await tx.select().from(itemState).where(eq(itemState.userId, userId)).orderBy(asc(itemState.createdAt), asc(itemState.planItemId)),
        sessions: await tx.select().from(workoutSession).where(eq(workoutSession.userId, userId)).orderBy(asc(workoutSession.createdAt), asc(workoutSession.id)),
        logs: await tx.select().from(setLog).where(eq(setLog.userId, userId)).orderBy(asc(setLog.createdAt), asc(setLog.sessionId), asc(setLog.position), asc(setLog.setNo), asc(setLog.id)),
      }
      return {
        version: 1 as const,
        exported_at: now().toISOString(),
        profile: toProfile(prof),
        gear: rows.gear.map(toGear),
        exercises: rows.exercises.map(toExercise),
        plans: rows.plans.map((r) => toPlan(r)),
        plan_days: rows.days.map(toPlanDay),
        plan_items: rows.items.map(toPlanItem),
        progression_rules: rows.rules.map(toRule),
        item_states: rows.states.map(toItemState),
        workout_sessions: rows.sessions.map(toSession),
        set_logs: rows.logs.map(toSetLog),
      }
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )
}

const MAX_WEIGHT = 999_999.99 // numeric(8,2)
const MAX_INT = 2_147_483_647

/** Checks the things the database would reject, so the caller gets ImportInvalidError instead of a 500. */
function checkIntegrity(d: ExportData): void {
  const bad = (msg: string): never => {
    throw new ImportInvalidError(msg)
  }
  const unique = (what: string, ids: string[]): Set<string> => {
    const set = new Set<string>()
    for (const id of ids) {
      if (!isUuid(id)) bad(`${what}: id is not a UUID`)
      if (set.has(id)) bad(`${what}: duplicate id`)
      set.add(id)
    }
    return set
  }
  const need = (what: string, id: string, into: Set<string>): void => {
    if (!isUuid(id) || !into.has(id)) bad(`${what}: references a row that is not in the file`)
  }

  unique('gear', d.gear.map((r) => r.id))
  const exerciseIds = unique('exercises', d.exercises.map((r) => r.id))
  const planIds = unique('plans', d.plans.map((r) => r.id))
  const dayIds = unique('plan_days', d.plan_days.map((r) => r.id))
  const itemIds = unique('plan_items', d.plan_items.map((r) => r.id))
  const sessionIds = unique('workout_sessions', d.workout_sessions.map((r) => r.id))
  unique('set_logs', d.set_logs.map((r) => r.id))
  unique('progression_rules', d.progression_rules.map((r) => r.plan_item_id))
  unique('item_states', d.item_states.map((r) => r.plan_item_id))

  for (const e of d.exercises) for (const g of e.required_gear_ids) if (!isUuid(g)) bad('exercises: gear id is not a UUID')
  for (const r of d.plan_days) need('plan_days', r.plan_id, planIds)
  for (const r of d.plan_items) {
    need('plan_items', r.plan_day_id, dayIds)
    need('plan_items', r.exercise_id, exerciseIds)
  }
  // Supersets: 2-3 live members, all in one day; deleted items never carry a group.
  const groups = new Map<string, { days: Set<string>; count: number }>()
  for (const r of d.plan_items) {
    if (r.superset_group === null) continue
    if (r.deleted_at !== null) bad('plan_items: a deleted item is in a superset')
    const g = groups.get(r.superset_group) ?? { days: new Set<string>(), count: 0 }
    g.days.add(r.plan_day_id)
    g.count++
    groups.set(r.superset_group, g)
  }
  for (const g of groups.values()) {
    if (g.days.size !== 1) bad('plan_items: a superset spans days')
    if (g.count > LIMITS.supersetMax) bad('plan_items: a superset has the wrong size')
  }
  // A group with fewer than 2 live members is a legacy state (a delete raced a regrouping): clear it.
  for (const r of d.plan_items) {
    if (r.superset_group !== null && (groups.get(r.superset_group)?.count ?? 0) < LIMITS.supersetMin) r.superset_group = null
  }
  const angled = new Set(d.exercises.filter((e) => e.supports_angle).map((e) => e.id))
  for (const r of d.plan_items) {
    if (r.deleted_at === null && r.angle !== null && !angled.has(r.exercise_id)) bad('plan_items: an angle is set on an exercise without angles')
  }
  for (const r of d.progression_rules) need('progression_rules', r.plan_item_id, itemIds)
  for (const r of d.item_states) need('item_states', r.plan_item_id, itemIds)
  for (const r of d.set_logs) {
    need('set_logs', r.session_id, sessionIds)
    if (!isUuid(r.plan_item_id) || !isUuid(r.exercise_id)) bad('set_logs: snapshot id is not a UUID')
  }
  for (const r of d.workout_sessions) if (!isUuid(r.plan_day_id)) bad('workout_sessions: plan_day_id is not a UUID')
  if (d.workout_sessions.filter((s) => s.completed_at === null && s.deleted_at === null).length > 1) {
    bad('workout_sessions: more than one active session')
  }

  const stamps = [d.profile, ...d.gear, ...d.exercises, ...d.plans, ...d.plan_days, ...d.plan_items, ...d.progression_rules, ...d.item_states, ...d.workout_sessions, ...d.set_logs]
  for (const r of stamps) {
    for (const v of [r.created_at, r.updated_at, r.deleted_at]) {
      if (v !== null && Number.isNaN(Date.parse(v))) bad('timestamp is not a valid date')
    }
  }
  for (const s of d.workout_sessions) {
    for (const v of [s.started_at, s.completed_at]) {
      if (v !== null && Number.isNaN(Date.parse(v))) bad('workout_sessions: timestamp is not a valid date')
    }
  }
  const weights = [
    d.profile.weight_increment,
    ...d.exercises.map((e) => e.default_weight),
    ...d.plan_items.flatMap((i) => [i.weight, i.target_weight]),
    ...d.progression_rules.map((r) => r.success_amount),
    ...d.set_logs.flatMap((l) => [l.weight, l.target_weight]),
  ]
  for (const w of weights) if (w !== null && w > MAX_WEIGHT) bad('a weight is out of range')
  const ints = [
    ...d.exercises.flatMap((e) => [e.default_sets, e.default_reps]),
    ...d.plan_days.map((r) => r.position),
    ...d.plan_items.flatMap((i) => [i.position, i.sets, i.reps, i.target_reps]),
    ...d.progression_rules.flatMap((r) => [r.fail_streak_limit, r.rep_ceiling]),
    ...d.item_states.map((s) => s.fail_streak),
    ...d.set_logs.flatMap((l) => [l.set_no, l.position, l.target_reps, l.actual_reps, l.seq]),
  ]
  for (const n of ints) if (n !== null && Math.abs(n) > MAX_INT) bad('a number is out of range')
}

const at = (s: string): Date => new Date(s)
const atOrNull = (s: string | null): Date | null => (s === null ? null : new Date(s))
const sync = (r: { created_at: string; updated_at: string; deleted_at: string | null }) => ({
  createdAt: at(r.created_at),
  updatedAt: at(r.updated_at),
  deletedAt: atOrNull(r.deleted_at),
})

async function insertChunked<T>(rows: T[], insert: (chunk: T[]) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < rows.length; i += 500) await insert(rows.slice(i, i + 500))
}

/** First-time import: ids and timestamps are kept, the owner is forced to the caller, nothing is seeded. */
export async function importAll(db: Db, userId: string, raw: ExportData): Promise<void> {
  const parsed = exportDataSchema.safeParse(raw)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    throw new ImportInvalidError(first ? `${first.path.join('.')}: ${first.message}` : 'Invalid import file')
  }
  const d = parsed.data
  checkIntegrity(d)
  try {
    await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(profile)
        .values({
          userId,
          // Only billing may set the tier (spec section 10); an uploaded file never can.
          plan: 'free',
          units: d.profile.units,
          weightIncrement: dec(d.profile.weight_increment),
          defaultRule: d.profile.default_rule ?? null,
          displayName: d.profile.display_name,
          ...sync(d.profile),
        })
        .onConflictDoNothing()
        .returning({ userId: profile.userId })
      if (inserted.length === 0) throw new AlreadyHasDataError()

      await insertChunked(d.gear, (c) =>
        tx.insert(gear).values(c.map((r) => ({ id: r.id, userId, name: r.name, owned: r.owned, ...sync(r) }))),
      )
      await insertChunked(d.exercises, (c) =>
        tx.insert(exercise).values(
          c.map((r) => ({
            id: r.id,
            userId,
            name: r.name,
            notes: r.notes,
            videoUrl: r.video_url,
            requiredGearIds: r.required_gear_ids,
            active: r.active,
            defaultSets: r.default_sets,
            defaultReps: r.default_reps,
            defaultWeight: dec(r.default_weight),
            supportsAngle: r.supports_angle,
            defaultRule: r.default_rule,
            ...sync(r),
          })),
        ),
      )
      await insertChunked(d.plans, (c) =>
        // `source` travels with the plan; `published` never does (a listing belongs to the account).
        tx.insert(plan).values(c.map((r) => ({ id: r.id, userId, name: r.name, archived: r.archived, source: r.source, ...sync(r) }))),
      )
      await insertChunked(d.plan_days, (c) =>
        tx
          .insert(planDay)
          .values(c.map((r) => ({ id: r.id, userId, planId: r.plan_id, name: r.name, position: r.position, color: r.color, ...sync(r) }))),
      )
      await insertChunked(d.plan_items, (c) =>
        tx.insert(planItem).values(
          c.map((r) => ({
            id: r.id,
            userId,
            planDayId: r.plan_day_id,
            exerciseId: r.exercise_id,
            position: r.position,
            sets: r.sets,
            reps: r.reps,
            weight: r.weight === null ? null : dec(r.weight),
            targetReps: r.target_reps,
            targetWeight: r.target_weight === null ? null : dec(r.target_weight),
            angle: r.angle,
            amrapLast: r.amrap_last,
            supersetGroup: r.superset_group,
            inheritRule: r.inherit_rule,
            ...sync(r),
          })),
        ),
      )
      await insertChunked(d.progression_rules, (c) =>
        tx.insert(progressionRule).values(
          c.map((r) => ({
            userId,
            planItemId: r.plan_item_id,
            successAction: r.success_action,
            successAmount: dec(r.success_amount),
            failStreakLimit: r.fail_streak_limit,
            deloadPct: dec(r.deload_pct),
            repCeiling: r.rep_ceiling,
            ...sync(r),
          })),
        ),
      )
      await insertChunked(d.item_states, (c) =>
        tx
          .insert(itemState)
          .values(c.map((r) => ({ userId, planItemId: r.plan_item_id, failStreak: r.fail_streak, ...sync(r) }))),
      )
      await insertChunked(d.workout_sessions, (c) =>
        tx.insert(workoutSession).values(
          c.map((r) => ({
            id: r.id,
            userId,
            planDayId: r.plan_day_id,
            planName: r.plan_name,
            dayName: r.day_name,
            startedAt: at(r.started_at),
            completedAt: atOrNull(r.completed_at),
            note: r.note,
            ...sync(r),
          })),
        ),
      )
      await insertChunked(d.set_logs, (c) =>
        tx.insert(setLog).values(
          c.map((r) => ({
            id: r.id,
            userId,
            sessionId: r.session_id,
            planItemId: r.plan_item_id,
            exerciseId: r.exercise_id,
            exerciseName: r.exercise_name,
            setNo: r.set_no,
            position: r.position,
            targetReps: r.target_reps,
            targetWeight: dec(r.target_weight),
            actualReps: r.actual_reps,
            weight: dec(r.weight),
            done: r.done,
            note: r.note,
            angle: r.angle,
            amrap: r.amrap,
            seq: r.seq,
            supersetGroup: r.superset_group,
            supersetLabel: r.superset_label,
            ...sync(r),
          })),
        ),
      )
    })
  } catch (err) {
    // Whatever the database still rejects (data exceptions, constraints) is a bad file, not a server fault.
    const code = pgCode(err)
    if (code && (code.startsWith('22') || code.startsWith('23'))) {
      throw new ImportInvalidError('The file contains values the database rejects')
    }
    throw err
  }
}
