import { z } from 'zod'

export const API_PREFIX = '/api/v1'

export const healthSchema = z.object({
  ok: z.boolean(),
})
export type Health = z.infer<typeof healthSchema>

// Bounds keep every accepted value inside what the database stores (numeric(8,2) holds up to
// 999999.99), so a request can never raise a raw DB error. They apply to LocalRepo too.
export const LIMITS = {
  name: 200,
  notes: 5000,
  url: 2000,
  sets: 100,
  reps: 1000,
  weight: 100_000,
  failStreak: 1000,
} as const

/** Client-generated resource ids (and path params) are UUIDs. */
export const idSchema = z.uuid()
const id = idSchema
// Auth user ids come from Better Auth and are not UUIDs.
const userId = z.string().min(1).max(200)
const timestamp = z.string().min(1).max(64)
const name = z.string().min(1).max(LIMITS.name)
const weight = z.number().min(0).max(LIMITS.weight)
const sets = z.number().int().min(1).max(LIMITS.sets)
const reps = z.number().int().min(1).max(LIMITS.reps)
// Stored as numeric(8,2): anything finer would round to 0.00 and break every read.
export const stepAmount = z.number().min(0.01).max(LIMITS.weight).multipleOf(0.01)

// Sync columns on every record; user-owned tables add user_id
const base = {
  created_at: timestamp,
  updated_at: timestamp,
  deleted_at: timestamp.nullable(),
}
const owned = { user_id: userId, ...base }

export const unitsSchema = z.enum(['lb', 'kg'])
export const planTierSchema = z.enum(['free', 'pro'])
export const successActionSchema = z.enum(['add_weight', 'add_reps'])

const ruleFields = {
  success_action: successActionSchema,
  success_amount: stepAmount,
  fail_streak_limit: z.number().int().min(1).max(LIMITS.failStreak),
  deload_pct: z.number().min(0).max(100),
  rep_ceiling: reps.nullable(),
}
// add_reps adds whole reps, at most 1000
const checkRule = (r: { success_action: string; success_amount: number }, ctx: z.RefinementCtx) => {
  if (r.success_action === 'add_reps' && (!Number.isInteger(r.success_amount) || r.success_amount > LIMITS.reps)) {
    ctx.addIssue({ code: 'custom', path: ['success_amount'], message: 'Must be a whole number of reps, at most 1000' })
  }
}
export const ruleInputSchema = z.object(ruleFields).superRefine(checkRule)
export type RuleInput = z.infer<typeof ruleInputSchema>

export const profileSchema = z.object({
  user_id: userId,
  plan: planTierSchema,
  units: unitsSchema,
  weight_increment: stepAmount,
  // Rule new plan items start with; absent means defaultRule(weight_increment)
  default_rule: ruleInputSchema.optional(),
  ...base,
})
export type Profile = z.infer<typeof profileSchema>

export const gearSchema = z.object({
  id,
  name,
  owned: z.boolean(),
  ...owned,
})
export type Gear = z.infer<typeof gearSchema>

export const exerciseInputSchema = z.object({
  id: id.optional(),
  name: z.string().trim().min(1).max(LIMITS.name),
  notes: z.string().max(LIMITS.notes),
  video_url: z.url({ protocol: /^https?$/ }).max(LIMITS.url).nullable(),
  required_gear_ids: z.array(id).max(200),
  active: z.boolean(),
  default_sets: sets,
  default_reps: reps,
  default_weight: weight,
})
export type ExerciseInput = z.infer<typeof exerciseInputSchema>

export const exerciseSchema = exerciseInputSchema.required({ id: true }).extend(owned)
export type Exercise = z.infer<typeof exerciseSchema>

export const planSchema = z.object({
  id,
  name,
  archived: z.boolean(),
  ...owned,
})
export type Plan = z.infer<typeof planSchema>

export const planDaySchema = z.object({
  id,
  plan_id: id,
  name,
  position: z.number().int().min(0).max(1_000_000),
  ...base,
})
export type PlanDay = z.infer<typeof planDaySchema>

export const planItemSchema = z.object({
  id,
  plan_day_id: id,
  exercise_id: id,
  position: z.number().int().min(0).max(1_000_000),
  sets: sets.nullable(),
  reps: reps.nullable(),
  weight: weight.nullable(),
  target_reps: reps.nullable(),
  target_weight: weight.nullable(),
  ...base,
})
export type PlanItem = z.infer<typeof planItemSchema>

// Keyed by plan_item_id (at most one per item)
export const progressionRuleSchema = z
  .object({
    ...ruleFields,
    plan_item_id: id,
    ...base,
  })
  .superRefine(checkRule)
export type ProgressionRule = z.infer<typeof progressionRuleSchema>

// Keyed by plan_item_id
export const itemStateSchema = z.object({
  plan_item_id: id,
  fail_streak: z.number().int().min(0).max(1_000_000),
  ...base,
})
export type ItemState = z.infer<typeof itemStateSchema>

export const workoutSessionSchema = z.object({
  id,
  plan_day_id: id,
  plan_name: z.string().max(LIMITS.name),
  day_name: z.string().max(LIMITS.name),
  started_at: timestamp,
  completed_at: timestamp.nullable(),
  note: z.string().max(LIMITS.notes),
  ...owned,
})
export type WorkoutSession = z.infer<typeof workoutSessionSchema>

export const setLogSchema = z.object({
  id,
  session_id: id,
  plan_item_id: id,
  exercise_id: id,
  exercise_name: z.string().max(LIMITS.name),
  set_no: z.number().int().min(1).max(LIMITS.sets),
  position: z.number().int().min(0).max(1_000_000),
  target_reps: z.number().int().min(0).max(LIMITS.reps),
  target_weight: weight,
  actual_reps: z.number().int().min(0).max(LIMITS.reps),
  weight,
  done: z.boolean(),
  note: z.string().max(LIMITS.notes),
  ...base,
})
export type SetLog = z.infer<typeof setLogSchema>
