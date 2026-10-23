import { z } from 'zod'
import type { ExportData } from './repo.js'
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
  workoutSessionSchema,
} from './schemas.js'

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
})

// Compile-time check: the schema and the ExportData type must describe the same shape.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
export const exportDataSchemaMatchesType: Same<z.infer<typeof exportDataSchema>, ExportData> = true
