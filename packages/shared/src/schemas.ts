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
  supersetMin: 2,
  supersetMax: 3,
  supersetLabel: 8,
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

/** Named plan-day colours; null on a day means the UI derives one from the day's position. */
export const DAY_COLORS = ['blue', 'red', 'green', 'amber', 'violet', 'teal', 'pink', 'slate'] as const
export const dayColorSchema = z.enum(DAY_COLORS)
export type DayColor = z.infer<typeof dayColorSchema>

/** Bench angle of a plan item; null means not applicable. */
export const ANGLES = ['flat', 'incline', 'decline'] as const
export const angleSchema = z.enum(ANGLES)
export type Angle = z.infer<typeof angleSchema>

/** Where an item's effective progression rule comes from (spec §6 rule layering). */
export const ruleSourceSchema = z.enum(['item', 'exercise', 'profile', 'builtin'])
export type RuleSource = z.infer<typeof ruleSourceSchema>

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

// C0/C1 control characters (MULTILINE keeps the newline), and format characters (zero-width,
// bidi overrides, soft hyphen) plus the Unicode line/paragraph separators, which can disguise text.
const CONTROLS = /[\u0000-\u001f\u007f-\u009f]/g
const CONTROLS_MULTILINE = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g
const FORMAT = /[\p{Cf}\u00ad\u2028\u2029]/gu
// Full-stop look-alikes that NFKC leaves alone (or maps to another look-alike) become '.', so the
// stored text and the link check see the same dot.
const DOTS = /[\u3002\uff61\u2024\ufe52\uff0e]/g

/** Strips format and control characters, applies NFKC (full-width letters become ASCII), then trims. */
export function cleanText(s: string, multiline = false): string {
  return s
    .replace(FORMAT, '')
    .normalize('NFKC')
    .replace(FORMAT, '')
    .replace(DOTS, '.')
    .replace(multiline ? CONTROLS_MULTILINE : CONTROLS, '')
    .trim()
}

// Links and their usual disguises: http(s)://, hxxp(s)://, www., bare domains (a letter or digit,
// a dot, then two or more letters: "spam.com", "shop.example.co.uk"), IPv4 literals and IPv6
// literals (bracketed, with "::", or four or more colon groups). Checked on cleaned text.
const LINK =
  /(h[tx]{2}ps?:\/\/|www\.|[\p{L}\p{N}]\.\p{L}{2,}|\b\d{1,3}(?:\.\d{1,3}){3}\b|\[[0-9a-f.]*:[0-9a-f:.]*\]|[0-9a-f]::|::[0-9a-f]|\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}\b)/iu

/** True when cleaned public text holds no link. */
export const isLinkFree = (s: string): boolean => !LINK.test(s)
export const LINK_MESSAGE = 'Links are not allowed'

/**
 * Every string shown publicly (titles, descriptions, names, snapshot text): cleaned with
 * `cleanText`, length-bounded and free of links. The cleaned form is what gets stored.
 */
export const publicText = (min: number, max: number, multiline = false) =>
  z
    .string()
    .transform((s) => cleanText(s, multiline))
    .pipe(z.string().min(min).max(max).refine(isLinkFree, LINK_MESSAGE))

/** Matching key for exercise and gear names: NFKC, trimmed, inner whitespace collapsed, lowercase. */
export function nameKey(s: string): string {
  return s.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
}

/** The only identity shown publicly (community plans). */
export const displayNameSchema = z
  .string()
  .transform((s) => cleanText(s))
  .pipe(
    z
      .string()
      .min(2)
      .max(30)
      .regex(/^[\p{L}\p{M}\p{N} _-]+$/u, 'Use letters, digits, spaces, _ and - only')
      .refine((s) => !/\p{M}{3}/u.test(s), 'Too many accents on one letter')
      .refine(isLinkFree, LINK_MESSAGE),
  )

export const LEVELS = ['beginner', 'intermediate', 'advanced'] as const
export const levelSchema = z.enum(LEVELS)
export type Level = z.infer<typeof levelSchema>

/** `hidden` is set by the service owner in the database; the sharer cannot reverse it. */
export const listingStatusSchema = z.enum(['published', 'unpublished', 'hidden'])
export type ListingStatus = z.infer<typeof listingStatusSchema>

/** "Based on <title> by <author>": where an adopted plan came from. */
export const planSourceSchema = z.object({
  shared_plan_id: id,
  version: z.number().int().min(1).max(1_000_000),
  title: publicText(1, 60),
  author: publicText(1, 30),
})
export type PlanSource = z.infer<typeof planSourceSchema>

/** The plan's own community listing (server only; always null on the device). */
export const planPublishedSchema = z.object({
  shared_plan_id: id,
  version: z.number().int().min(1).max(1_000_000),
  status: listingStatusSchema,
})
export type PlanPublished = z.infer<typeof planPublishedSchema>

export const profileSchema = z.object({
  user_id: userId,
  plan: planTierSchema,
  units: unitsSchema,
  weight_increment: stepAmount,
  // Rule new plan items start with; absent means defaultRule(weight_increment)
  default_rule: ruleInputSchema.optional(),
  // Public name for community plans; required to publish.
  display_name: displayNameSchema.nullable().default(null),
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
  // Optional on input so a save that does not mention it keeps the stored value (false on create).
  supports_angle: z.boolean().optional(),
})
export type ExerciseInput = z.infer<typeof exerciseInputSchema>

// New fields default on parse, so rows and exports written before them still load.
export const exerciseSchema = exerciseInputSchema.required({ id: true }).extend({
  supports_angle: z.boolean().default(false),
  // Default progression rule for this exercise's items (between the item override and the profile's).
  default_rule: ruleInputSchema.nullable().default(null),
  ...owned,
})
export type Exercise = z.infer<typeof exerciseSchema>

export const planSchema = z.object({
  id,
  name,
  archived: z.boolean(),
  // Set on copies of community plans; null on the user's own plans.
  source: planSourceSchema.nullable().default(null),
  // The user's own listing of this plan, if any (computed by the server; not imported).
  published: planPublishedSchema.nullable().default(null),
  ...owned,
})
export type Plan = z.infer<typeof planSchema>

export const planDaySchema = z.object({
  id,
  plan_id: id,
  name,
  position: z.number().int().min(0).max(1_000_000),
  color: dayColorSchema.nullable().default(null),
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
  angle: angleSchema.nullable().default(null),
  // The item's last set is "as many reps as possible"; target_reps stays the minimum.
  amrap_last: z.boolean().default(false),
  // Shared by the 2-3 items of one superset in the same day.
  superset_group: id.nullable().default(null),
  // true: no rule row means "inherit" (exercise, then profile, then built-in default).
  // false (rows from before layering): no rule row means "no progression". A rule row always wins.
  inherit_rule: z.boolean().default(false),
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
  // Snapshots taken at session start (null/false on rows from before they existed).
  angle: angleSchema.nullable().default(null),
  amrap: z.boolean().default(false),
  // Display order within the session; null falls back to (position, set_no).
  seq: z.number().int().min(0).max(1_000_000).nullable().default(null),
  superset_group: id.nullable().default(null),
  superset_label: z.string().min(1).max(LIMITS.supersetLabel).nullable().default(null),
  ...base,
})
export type SetLog = z.infer<typeof setLogSchema>
