// Row -> shared record mappers. Postgres boundary rules: timestamps become ISO strings,
// numeric columns (returned as strings by the driver) become numbers, jsonb is re-validated.
import {
  exerciseSchema,
  gearSchema,
  planDaySchema,
  planItemSchema,
  planSchema,
  profileSchema,
  progressionRuleSchema,
  ruleInputSchema,
} from '@workout/shared'
import type { Exercise, Gear, Plan, PlanDay, PlanItem, Profile, ProgressionRule } from '@workout/shared'
import type { exercise, gear, plan, planDay, planItem, profile, progressionRule } from '../db/schema.js'

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
/** Numbers go to numeric columns as strings. */
export const dec = (n: number): string => String(n)

export function toProfile(row: typeof profile.$inferSelect): Profile {
  return profileSchema.parse({
    user_id: row.userId,
    plan: row.plan,
    units: row.units,
    weight_increment: num(row.weightIncrement),
    ...(row.defaultRule === null ? {} : { default_rule: ruleInputSchema.parse(row.defaultRule) }),
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
    default_weight: num(row.defaultWeight),
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
    weight: numOrNull(row.weight),
    target_reps: row.targetReps,
    target_weight: numOrNull(row.targetWeight),
    ...syncOf(row),
  })
}

export function toRule(row: typeof progressionRule.$inferSelect): ProgressionRule {
  return progressionRuleSchema.parse({
    plan_item_id: row.planItemId,
    success_action: row.successAction,
    success_amount: num(row.successAmount),
    fail_streak_limit: row.failStreakLimit,
    deload_pct: num(row.deloadPct),
    rep_ceiling: row.repCeiling,
    ...syncOf(row),
  })
}
