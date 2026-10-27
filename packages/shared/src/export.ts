import { z } from 'zod'
import type { ExportData } from './repo.js'
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
