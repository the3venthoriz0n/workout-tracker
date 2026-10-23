import { z } from 'zod'
import { exportDataSchema } from './export.js'
import {
  LIMITS,
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

export const IdParam = idSchema

export const PutGearBody = gearSchema.pick({ name: true, owned: true })
export const PutExerciseBody = exerciseInputSchema.omit({ id: true })
export const PutPlanBody = planSchema.pick({ name: true })
export const PutDayBody = planDaySchema.pick({ plan_id: true, name: true })
export const PatchProfileBody = z.object({
  units: unitsSchema.optional(),
  weight_increment: z.number().gt(0).max(LIMITS.weight).optional(),
  default_rule: ruleInputSchema.optional(),
})
export const AddItemBody = z.object({ exercise_id: idSchema, id: idSchema.optional() })
export const PatchItemBody = planItemSchema.pick({ sets: true, reps: true, weight: true }).partial()
export const PutRuleBody = z.object({ rule: ruleInputSchema.nullable() })
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
      .optional() })
export const ImportBody = exportDataSchema
export const EmptyBody = z.object({})
