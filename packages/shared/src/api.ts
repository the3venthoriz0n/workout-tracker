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

// Request bodies for the REST API (spec section 9). Unknown keys are STRIPPED (zod default),
// never echoed and never trusted: user_id, timestamps and the path's `:id` always win.
// A body `id` is not accepted at all: the id is the path param.

const MAX_CLOCK_SKEW_MS = 5 * 60_000

export const IdParam = idSchema

export const PutGearBody = gearSchema.pick({ name: true, owned: true })
export const PutExerciseBody = exerciseInputSchema.omit({ id: true })
export const PutPlanBody = planSchema.pick({ name: true })
// color: omitted keeps the stored colour, null clears it
export const PutDayBody = planDaySchema.pick({ plan_id: true, name: true }).extend({ color: dayColorSchema.nullable().optional() })
export const PatchProfileBody = z.object({
  units: unitsSchema.optional(),
  weight_increment: stepAmount.optional(),
  default_rule: ruleInputSchema.optional(),
  display_name: displayNameSchema.optional(),
})
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
export const EmptyBody = z.object({})
// Account deletion asks for the current password (Better Auth's own limits: at most 128 characters).
export const DeleteAccountBody = z.object({ password: z.string().min(1).max(128) })
/** POST /import/replace: the password plus an export file (validated separately, as ImportInvalidError). */
export const ReplaceImportBody = z.object({ password: DeleteAccountBody.shape.password, data: z.unknown() })
