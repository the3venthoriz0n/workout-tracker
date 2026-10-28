import { z } from 'zod'
import type { ExportData } from './repo.js'
import { ImportInvalidError } from './repo.js'
import { sharedListingSchema } from './community.js'
import {
  exerciseSchema,
  gearSchema,
  itemStateSchema,
  planDaySchema,
  planItemSchema,
  planSchema,
  profileSchema,
  progressionRuleSchema,
  setLogSchema,
  idSchema,
  workoutSessionSchema,
  LIMITS,
} from './schemas.js'

/** The account itself (server exports only): the sign-in email and when the account was created. */
export const exportAccountSchema = z.object({ email: z.string(), created_at: z.string() })
export type ExportAccount = z.infer<typeof exportAccountSchema>

/**
 * The account's community data (server exports only): its listings with every published version,
 * its upvotes and its counted downloads. Exported for completeness; import ignores it.
 */
export const exportCommunitySchema = z.object({
  listings: z.array(
    sharedListingSchema.extend({
      versions: z.array(
        z.object({ version: z.number().int().min(1), created_at: z.string(), snapshot: z.record(z.string(), z.unknown()) }),
      ),
    }),
  ),
  votes: z.array(z.object({ shared_plan_id: idSchema, created_at: z.string() })),
  downloads: z.array(z.object({ shared_plan_id: idSchema, first_version: z.number().int().min(1), created_at: z.string() })),
})
export type ExportCommunity = z.infer<typeof exportCommunitySchema>

export const exportDataSchema = z.object({
  version: z.literal(1),
  exported_at: z.string().min(1),
  profile: profileSchema,
  gear: z.array(gearSchema),
  exercises: z.array(exerciseSchema),
  plans: z.array(planSchema),
  plan_days: z.array(planDaySchema),
  plan_items: z.array(planItemSchema),
  progression_rules: z.array(progressionRuleSchema),
  item_states: z.array(itemStateSchema),
  workout_sessions: z.array(workoutSessionSchema),
  set_logs: z.array(setLogSchema),
  // Additive (M2c): absent in guest exports and in exports written before them.
  account: exportAccountSchema.optional(),
  community: exportCommunitySchema.optional(),
})

// Compile-time check: the schema and the ExportData type must describe the same shape.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
export const exportDataSchemaMatchesType: Same<z.infer<typeof exportDataSchema>, ExportData> = true

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isUuid = (value: string): boolean => UUID_RE.test(value)

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

/**
 * The one import validation, shared by the server (first-time import and restore) and LocalRepo
 * (restore): the export schema (which applies the public-text rule to `source` and `display_name`),
 * then references, supersets, angles, timestamps and number ranges. Throws ImportInvalidError and
 * never writes anything. A superset with fewer than 2 live members is cleared (legacy state).
 */
export function parseImport(raw: unknown): ExportData {
  const parsed = exportDataSchema.safeParse(raw)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    throw new ImportInvalidError(first ? `${first.path.join('.')}: ${first.message}` : 'Invalid import file')
  }
  const d = parsed.data
  checkIntegrity(d)
  return d
}
