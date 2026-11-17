// Which nutrients a user tracks and their goals. A leaf module (it imports only zod) so the profile
// schema can use it without an import cycle with nutrition.ts.
import { z } from 'zod'

/** The nutrients, in canonical order. Everything keyed by nutrient uses these keys. */
export const NUTRIENTS = [
  { key: 'calories', label: 'Calories', unit: 'kcal' },
  { key: 'protein_g', label: 'Protein', unit: 'g' },
  { key: 'carbs_g', label: 'Carbs', unit: 'g' },
  { key: 'fat_g', label: 'Fat', unit: 'g' },
  { key: 'fiber_g', label: 'Fiber', unit: 'g' },
  { key: 'sugar_g', label: 'Sugar', unit: 'g' },
  { key: 'sodium_mg', label: 'Sodium', unit: 'mg' },
] as const

export type NutrientKey = (typeof NUTRIENTS)[number]['key']
export const NUTRIENT_KEYS = NUTRIENTS.map((n) => n.key) as readonly NutrientKey[]
export const nutrientKeySchema = z.enum(NUTRIENT_KEYS as [NutrientKey, ...NutrientKey[]])

/** What a user tracks until they choose otherwise. */
export const DEFAULT_TRACKED: NutrientKey[] = ['calories', 'protein_g']

export const NUTRITION_LIMITS = {
  // Per entry (and the ceiling for a daily goal)
  calories: 10_000,
  protein_g: 1000,
  carbs_g: 1000,
  fat_g: 1000,
  fiber_g: 1000,
  sugar_g: 1000,
  sodium_mg: 20_000,
  name: 120,
  quantity: 60,
  /** Meal text sent to the AI. */
  text: 500,
  perDay: 300,
  /** The widest range one list request may ask for. */
  rangeDays: 366,
  daysBack: 365,
  daysAhead: 2,
} as const

const goal = (k: NutrientKey) => z.number().positive().max(NUTRITION_LIMITS[k]).optional()
const byCanonicalOrder = (a: NutrientKey, b: NutrientKey) => NUTRIENT_KEYS.indexOf(a) - NUTRIENT_KEYS.indexOf(b)

export const nutritionSettingsSchema = z.object({
  tracked: z
    .array(nutrientKeySchema)
    .min(1)
    .max(NUTRIENT_KEYS.length)
    .refine((keys) => new Set(keys).size === keys.length, 'Each nutrient can be tracked once')
    .transform((keys) => [...keys].sort(byCanonicalOrder)),
  goals: z
    .object({
      calories: goal('calories'),
      protein_g: goal('protein_g'),
      carbs_g: goal('carbs_g'),
      fat_g: goal('fat_g'),
      fiber_g: goal('fiber_g'),
      sugar_g: goal('sugar_g'),
      sodium_mg: goal('sodium_mg'),
    })
    .default({}),
})
export type NutritionSettings = z.infer<typeof nutritionSettingsSchema>

/** A profile's settings, or the defaults when it has none. */
export function nutritionSettingsOf(profile: { nutrition?: NutritionSettings | undefined }): NutritionSettings {
  return profile.nutrition ?? { tracked: [...DEFAULT_TRACKED], goals: {} }
}
