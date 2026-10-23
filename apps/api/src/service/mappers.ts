// Row -> shared record mappers. Postgres boundary rules: timestamps become ISO strings,
// numeric columns (returned as strings by the driver) become numbers, jsonb is re-validated.
import {
  LIMITS,
  exerciseSchema,
  gearSchema,
  itemStateSchema,
  planDaySchema,
  planItemSchema,
  planSchema,
  profileSchema,
  progressionRuleSchema,
  ruleInputSchema,
  setLogSchema,
  workoutSessionSchema,
} from '@workout/shared'
import type {
  Exercise,
  RuleInput,
  Gear,
  ItemState,
  Plan,
  PlanDay,
  PlanItem,
  Profile,
  ProgressionRule,
  SetLog,
  WorkoutSession,
} from '@workout/shared'
import type {
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

export const now = (): Date => new Date()

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (value: string): boolean => UUID_RE.test(value)

/** A client id the database cannot store can never match a row, so lookups treat it as missing. */
export function assertUuid(value: string, what: string): string {
  if (!isUuid(value)) throw new Error(`${what} must be a UUID`)
  return value
}

const iso = (d: Date): string => d.toISOString()
const isoOrNull = (d: Date | null): string | null => (d === null ? null : d.toISOString())
export const num = (n: string): number => Number(n)
export const numOrNull = (n: string | null): number | null => (n === null ? null : Number(n))
// Rows saved before the bounds existed (or by a conversion) may sit outside the valid range.
// Clamp on read so the account stays usable and the next edit can fix the value.
const clampWeight = (n: number): number => Math.min(LIMITS.weight, Math.max(0, n))
const clampWeightOrNull = (n: string | null): number | null => (n === null ? null : clampWeight(Number(n)))
const ruleAmount = (action: string, n: number): number =>
  action === 'add_reps' ? Math.min(LIMITS.reps, Math.max(1, Math.round(n))) : clampStep(n)
const clampStep = (n: number): number => Math.min(LIMITS.weight, Math.max(0.01, n))
/** Numbers go to numeric columns as strings. */
export const dec = (n: number): string => String(n)

/** Reads the stored default rule, clamping an amount saved before the precision rules existed. */
export function readRule(stored: unknown): RuleInput {
  const r = stored as { success_action?: string; success_amount?: unknown }
  return ruleInputSchema.parse({ ...r, success_amount: ruleAmount(String(r.success_action), Number(r.success_amount)) })
}

export function toProfile(row: typeof profile.$inferSelect): Profile {
  return profileSchema.parse({
    user_id: row.userId,
    plan: row.plan,
    units: row.units,
    weight_increment: clampStep(num(row.weightIncrement)),
    ...(row.defaultRule === null ? {} : { default_rule: readRule(row.defaultRule) }),
    created_at: iso(row.createdAt),
    updated_at: iso(row.updatedAt),
    deleted_at: isoOrNull(row.deletedAt),
  })
}

export function toGear(row: typeof gear.$inferSelect): Gear {
  return gearSchema.parse({
    id: row.id,
    name: row.name,
    owned: row.owned,
    user_id: row.userId,
    created_at: iso(row.createdAt),
    updated_at: iso(row.updatedAt),
    deleted_at: isoOrNull(row.deletedAt),
  })
}

export function toExercise(row: typeof exercise.$inferSelect): Exercise {
  return exerciseSchema.parse({
    id: row.id,
    name: row.name,
    notes: row.notes,
    video_url: row.videoUrl,
    required_gear_ids: row.requiredGearIds,
    active: row.active,
    default_sets: row.defaultSets,
    default_reps: row.defaultReps,
    default_weight: clampWeight(num(row.defaultWeight)),
    user_id: row.userId,
    created_at: iso(row.createdAt),
    updated_at: iso(row.updatedAt),
    deleted_at: isoOrNull(row.deletedAt),
  })
}

export const byName = <T extends { name: string }>(a: T, b: T): number => a.name.localeCompare(b.name)

const syncOf = (row: { createdAt: Date; updatedAt: Date; deletedAt: Date | null }) => ({
  created_at: iso(row.createdAt),
  updated_at: iso(row.updatedAt),
  deleted_at: isoOrNull(row.deletedAt),
})

export function toPlan(row: typeof plan.$inferSelect): Plan {
  return planSchema.parse({
    id: row.id,
    name: row.name,
    archived: row.archived,
    user_id: row.userId,
    ...syncOf(row),
  })
}

export function toPlanDay(row: typeof planDay.$inferSelect): PlanDay {
  return planDaySchema.parse({
    id: row.id,
    plan_id: row.planId,
    name: row.name,
    position: row.position,
    ...syncOf(row),
  })
}

export function toPlanItem(row: typeof planItem.$inferSelect): PlanItem {
  return planItemSchema.parse({
    id: row.id,
    plan_day_id: row.planDayId,
    exercise_id: row.exerciseId,
    position: row.position,
    sets: row.sets,
    reps: row.reps,
    weight: clampWeightOrNull(row.weight),
    target_reps: row.targetReps,
    target_weight: clampWeightOrNull(row.targetWeight),
    ...syncOf(row),
  })
}

export function toRule(row: typeof progressionRule.$inferSelect): ProgressionRule {
  return progressionRuleSchema.parse({
    plan_item_id: row.planItemId,
    success_action: row.successAction,
    success_amount: ruleAmount(row.successAction, num(row.successAmount)),
    fail_streak_limit: row.failStreakLimit,
    deload_pct: num(row.deloadPct),
    rep_ceiling: row.repCeiling,
    ...syncOf(row),
  })
}

export function toItemState(row: typeof itemState.$inferSelect): ItemState {
  return itemStateSchema.parse({ plan_item_id: row.planItemId, fail_streak: row.failStreak, ...syncOf(row) })
}

export function toSession(row: typeof workoutSession.$inferSelect): WorkoutSession {
  return workoutSessionSchema.parse({
    id: row.id,
    plan_day_id: row.planDayId,
    plan_name: row.planName,
    day_name: row.dayName,
    started_at: iso(row.startedAt),
    completed_at: isoOrNull(row.completedAt),
    note: row.note,
    user_id: row.userId,
    ...syncOf(row),
  })
}

export function toSetLog(row: typeof setLog.$inferSelect): SetLog {
  return setLogSchema.parse({
    id: row.id,
    session_id: row.sessionId,
    plan_item_id: row.planItemId,
    exercise_id: row.exerciseId,
    exercise_name: row.exerciseName,
    set_no: row.setNo,
    position: row.position,
    target_reps: row.targetReps,
    target_weight: clampWeight(num(row.targetWeight)),
    actual_reps: row.actualReps,
    weight: clampWeight(num(row.weight)),
    done: row.done,
    note: row.note,
    ...syncOf(row),
  })
}
