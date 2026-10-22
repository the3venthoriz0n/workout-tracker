import { z } from 'zod'

export const API_PREFIX = '/api/v1'

export const healthSchema = z.object({
  ok: z.boolean(),
})
export type Health = z.infer<typeof healthSchema>

const id = z.string().min(1)
const timestamp = z.string().min(1)
const weight = z.number().min(0)
const sets = z.number().int().min(1)
const reps = z.number().int().min(1)

// Sync columns on every record; user-owned tables add user_id
const base = {
  created_at: timestamp,
  updated_at: timestamp,
  deleted_at: timestamp.nullable(),
}
const owned = { user_id: id, ...base }

export const unitsSchema = z.enum(['lb', 'kg'])
export const planTierSchema = z.enum(['free', 'pro'])
export const successActionSchema = z.enum(['add_weight', 'add_reps'])

export const profileSchema = z.object({
  user_id: id,
  plan: planTierSchema,
  units: unitsSchema,
  weight_increment: z.number().gt(0),
  ...base,
})
export type Profile = z.infer<typeof profileSchema>

export const gearSchema = z.object({
  id,
  name: z.string().min(1),
  owned: z.boolean(),
  ...owned,
})
export type Gear = z.infer<typeof gearSchema>

export const exerciseInputSchema = z.object({
  id: id.optional(),
  name: z.string().trim().min(1),
  notes: z.string(),
  video_url: z.url({ protocol: /^https?$/ }).nullable(),
  required_gear_ids: z.array(id),
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
  name: z.string().min(1),
  archived: z.boolean(),
  ...owned,
})
export type Plan = z.infer<typeof planSchema>

export const planDaySchema = z.object({
  id,
  plan_id: id,
  name: z.string().min(1),
  position: z.number().int(),
  ...base,
})
export type PlanDay = z.infer<typeof planDaySchema>

export const planItemSchema = z.object({
  id,
  plan_day_id: id,
  exercise_id: id,
  position: z.number().int(),
  sets: sets.nullable(),
  reps: reps.nullable(),
  weight: weight.nullable(),
  target_reps: reps.nullable(),
  target_weight: weight.nullable(),
  ...base,
})
export type PlanItem = z.infer<typeof planItemSchema>

export const ruleInputSchema = z.object({
  success_action: successActionSchema,
  success_amount: z.number().gt(0),
  fail_streak_limit: z.number().int().min(1),
  deload_pct: z.number().min(0).max(100),
  rep_ceiling: reps.nullable(),
})
export type RuleInput = z.infer<typeof ruleInputSchema>

// Keyed by plan_item_id (at most one per item)
export const progressionRuleSchema = ruleInputSchema.extend({
  plan_item_id: id,
  ...base,
})
export type ProgressionRule = z.infer<typeof progressionRuleSchema>

// Keyed by plan_item_id
export const itemStateSchema = z.object({
  plan_item_id: id,
  fail_streak: z.number().int().min(0),
  ...base,
})
export type ItemState = z.infer<typeof itemStateSchema>

export const workoutSessionSchema = z.object({
  id,
  plan_day_id: id,
  plan_name: z.string(),
  day_name: z.string(),
  started_at: timestamp,
  completed_at: timestamp.nullable(),
  note: z.string(),
  ...owned,
})
export type WorkoutSession = z.infer<typeof workoutSessionSchema>

export const setLogSchema = z.object({
  id,
  session_id: id,
  plan_item_id: id,
  exercise_id: id,
  exercise_name: z.string(),
  set_no: z.number().int().min(1),
  position: z.number().int().min(0),
  target_reps: z.number().int().min(0),
  target_weight: weight,
  actual_reps: z.number().int().min(0),
  weight,
  done: z.boolean(),
  note: z.string(),
  ...base,
})
export type SetLog = z.infer<typeof setLogSchema>
