import { z } from 'zod'
import { exportDataSchema } from './export.js'
import { listingMetaSchema } from './community.js'
import {
  LIMITS,
  angleSchema,
  displayNameSchema,
  dayColorSchema,
  stepAmount,
  exerciseInputSchema,
  gearSchema,
  idSchema,
  planDaySchema,
  planItemSchema,
  planSchema,
  ruleInputSchema,
  setLogSchema,
  unitsSchema,
  workoutSessionSchema,
} from './schemas.js'
import { NUTRITION_LIMITS, nutritionEntryInputSchema, nutritionSettingsSchema } from './nutrition.js'

// Request bodies for the REST API (spec section 9). Unknown keys are STRIPPED (zod default),
// never echoed and never trusted: user_id, timestamps and the path's `:id` always win.
// A body `id` is not accepted at all: the id is the path param.

const MAX_CLOCK_SKEW_MS = 5 * 60_000

export const IdParam = idSchema

export const PutGearBody = gearSchema.pick({ name: true, owned: true, max_weight: true })
export const PutExerciseBody = exerciseInputSchema.omit({ id: true })
export const PutPlanBody = planSchema.pick({ name: true })
// color: omitted keeps the stored colour, null clears it
export const PutDayBody = planDaySchema.pick({ plan_id: true, name: true }).extend({ color: dayColorSchema.nullable().optional() })
export const PatchProfileBody = z.object({
  units: unitsSchema.optional(),
  weight_increment: stepAmount.optional(),
  default_rule: ruleInputSchema.optional(),
  display_name: displayNameSchema.optional(),
  nutrition: nutritionSettingsSchema.optional(),
})
export const PutNutritionEntryBody = nutritionEntryInputSchema.omit({ id: true })
/** The meal text the AI reads: trimmed, 1 to 500 characters. */
export const ParseMealBody = z.object({
  text: z.string().transform((t) => t.trim()).pipe(z.string().min(1).max(NUTRITION_LIMITS.text)),
})
/** A user's own AI provider. The key is write-only: it is never returned. `base_url` is required for an openai-compatible service. */
export const AiKeyBody = z
  .object({
    provider: z.enum(['openai', 'anthropic']),
    base_url: z.url().max(300).optional(),
    model: z.string().trim().min(1).max(200).regex(/^\S+$/, 'must not contain spaces'),
    api_key: z.string().trim().min(8).max(500).regex(/^\S+$/, 'must not contain spaces'),
  })
  .superRefine((v, ctx) => {
    if (v.provider === 'openai' && !v.base_url) ctx.addIssue({ code: 'custom', path: ['base_url'], message: 'required for an OpenAI-compatible service' })
  })
export type AiKeyInput = z.infer<typeof AiKeyBody>
/** What the app may know about a saved key: that it exists and where it points, never the key. */
export type AiKeyInfo = { configured: false } | { configured: true; provider: 'openai' | 'anthropic'; base_url: string | null; model: string }
export const AddItemBody = z.object({ exercise_id: idSchema, id: idSchema.optional() })
export const PatchItemBody = planItemSchema
  .pick({ sets: true, reps: true, weight: true })
  .extend({ angle: angleSchema.nullable(), amrap_last: z.boolean() })
  .partial()
export const PutRuleBody = z.object({ rule: ruleInputSchema.nullable() })
// item_ids: the 2-3 members of the group; null dissolves it
export const PutSupersetBody = z.object({
  item_ids: z.array(idSchema).min(LIMITS.supersetMin).max(LIMITS.supersetMax).nullable(),
})
export const MoveBody = z.object({
  kind: z.enum(['day', 'item']),
  id: idSchema,
  direction: z.union([z.literal(-1), z.literal(1)]),
})
export const StartSessionBody = z.object({ plan_day_id: idSchema })
export const PatchSessionBody = workoutSessionSchema.pick({ note: true })
export const PatchSetBody = setLogSchema
  .pick({ done: true, actual_reps: true, weight: true, note: true })
  .partial()
  .extend({ updated_at: z.iso
      .datetime({ offset: true })
      .refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid timestamp')
      // A client clock far ahead would make a stale edit win every later last-write-wins race.
      .refine((v) => Date.parse(v) <= Date.now() + MAX_CLOCK_SKEW_MS, 'Timestamp is in the future')
      .optional() })
export const ImportBody = exportDataSchema
export const PublishBody = listingMetaSchema
// Only the version: the snapshot is always loaded from the database, never taken from the client.
export const AdoptBody = z.object({ version: z.number().int().min(1).max(1_000_000).optional() })
// Account deletion asks for the current password (Better Auth's own limits: at most 128 characters).
export const DeleteAccountBody = z.object({ password: z.string().min(1).max(128) })
/** POST /import/replace: the password plus an export file (validated separately, as ImportInvalidError). */
export const ReplaceImportBody = z.object({ password: DeleteAccountBody.shape.password, data: z.unknown() })
