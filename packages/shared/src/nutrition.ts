import { z } from 'zod'
import { NUTRIENT_KEYS, NUTRITION_LIMITS, type NutrientKey, type NutritionSettings } from './nutrition-settings.js'
import { cleanText, idSchema, ownedColumns } from './schemas.js'

export * from './nutrition-settings.js'

const value = (k: NutrientKey) => z.number().min(0).max(NUTRITION_LIMITS[k]).nullable()
// null means "not estimated" (the nutrient was not tracked when the entry was logged).
const nutrientFields = {
  calories: value('calories'),
  protein_g: value('protein_g'),
  carbs_g: value('carbs_g'),
  fat_g: value('fat_g'),
  fiber_g: value('fiber_g'),
  sugar_g: value('sugar_g'),
  sodium_mg: value('sodium_mg'),
}

const isRealDate = (s: string): boolean => {
  const d = new Date(`${s}T00:00:00.000Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}
/** A calendar day, `YYYY-MM-DD`, as the client's local date. */
export const nutritionDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isRealDate, 'Not a real date')

const text = (max: number, min = 0) => z.string().transform((s) => cleanText(s)).pipe(z.string().min(min).max(max))

/** What the AI returns for one food, and what an entry is made of. */
export const mealDraftSchema = z.object({
  name: text(NUTRITION_LIMITS.name, 1),
  quantity: text(NUTRITION_LIMITS.quantity),
  ...nutrientFields,
})
export type MealDraft = z.infer<typeof mealDraftSchema>

export const nutritionEntryInputSchema = mealDraftSchema.extend({
  id: idSchema.optional(),
  date: nutritionDateSchema,
  /** 'ai' marks an estimate; saving an edit by hand sets 'manual'. */
  source: z.enum(['ai', 'manual']),
})
export type NutritionEntryInput = z.infer<typeof nutritionEntryInputSchema>

export const nutritionEntrySchema = nutritionEntryInputSchema.required({ id: true }).extend(ownedColumns)
export type NutritionEntry = z.infer<typeof nutritionEntrySchema>

const DAY_MS = 86_400_000
/** True for a real date from a year back to two days ahead of `today` (both `YYYY-MM-DD`). */
export function isNutritionDate(date: string, today: string): boolean {
  if (!nutritionDateSchema.safeParse(date).success || !nutritionDateSchema.safeParse(today).success) return false
  const diff = (Date.parse(`${date}T00:00:00.000Z`) - Date.parse(`${today}T00:00:00.000Z`)) / DAY_MS
  return diff >= -NUTRITION_LIMITS.daysBack && diff <= NUTRITION_LIMITS.daysAhead
}

export type NutrientTotal = {
  total: number
  /** How many entries had a value for this nutrient. */
  counted: number
  goal: number | null
  /** Goal minus total; negative when over; null without a goal. */
  left: number | null
}

const round1 = (n: number) => Math.round(n * 10) / 10

/** Each nutrient's sum over the entries that have a value for it, against its goal. */
export function dayTotals(
  entries: readonly Partial<Record<NutrientKey, number | null>>[],
  settings: NutritionSettings,
): Record<NutrientKey, NutrientTotal> {
  const out = {} as Record<NutrientKey, NutrientTotal>
  for (const key of NUTRIENT_KEYS) {
    let sum = 0
    let counted = 0
    for (const e of entries) {
      const v = e[key]
      if (v === null || v === undefined) continue
      sum += v
      counted++
    }
    const total = round1(sum)
    const goal = settings.goals[key] ?? null
    out[key] = { total, counted, goal, left: goal === null ? null : round1(goal - total) }
  }
  return out
}
