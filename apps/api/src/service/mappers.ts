// Row -> shared record mappers. Postgres boundary rules: timestamps become ISO strings,
// numeric columns (returned as strings by the driver) become numbers, jsonb is re-validated.
import { exerciseSchema, gearSchema, profileSchema, ruleInputSchema } from '@workout/shared'
import type { Exercise, Gear, Profile } from '@workout/shared'
import type { exercise, gear, profile } from '../db/schema.js'

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
