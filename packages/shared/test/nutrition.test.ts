import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TRACKED,
  NUTRIENTS,
  NUTRITION_LIMITS,
  ParseMealBody,
  PatchProfileBody,
  PutNutritionEntryBody,
  can,
  dayTotals,
  exportDataSchema,
  isNutritionDate,
  limit,
  mealDraftSchema,
  nutritionEntryInputSchema,
  nutritionSettingsOf,
  nutritionSettingsSchema,
  profileSchema,
} from '../src/index.js'

const entry = (over: Record<string, unknown> = {}) => ({
  date: '2026-11-16',
  name: 'Chicken burrito',
  quantity: '1 burrito',
  calories: 680,
  protein_g: 32,
  carbs_g: null,
  fat_g: null,
  fiber_g: null,
  sugar_g: null,
  sodium_mg: null,
  source: 'ai',
  ...over,
})

describe('nutrition settings', () => {
  it('tracked defaults to calories and protein and is kept in canonical order', () => {
    expect(DEFAULT_TRACKED).toEqual(['calories', 'protein_g'])
    expect(NUTRIENTS.map((n) => n.key)).toEqual(['calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sugar_g', 'sodium_mg'])
    expect(nutritionSettingsOf({})).toEqual({ tracked: ['calories', 'protein_g'], goals: {} })
    expect(nutritionSettingsSchema.parse({ tracked: ['fat_g', 'calories'], goals: {} }).tracked).toEqual(['calories', 'fat_g'])
  })

  it('rejects an empty tracked list, an unknown key, a duplicate and a goal above the limit', () => {
    expect(nutritionSettingsSchema.safeParse({ tracked: [], goals: {} }).success).toBe(false)
    expect(nutritionSettingsSchema.safeParse({ tracked: ['calories', 'zinc'], goals: {} }).success).toBe(false)
    expect(nutritionSettingsSchema.safeParse({ tracked: ['calories', 'calories'], goals: {} }).success).toBe(false)
    expect(nutritionSettingsSchema.safeParse({ tracked: ['calories'], goals: { calories: NUTRITION_LIMITS.calories + 1 } }).success).toBe(false)
    expect(nutritionSettingsSchema.safeParse({ tracked: ['calories'], goals: { calories: 0 } }).success).toBe(false)
    expect(nutritionSettingsSchema.safeParse({ tracked: ['calories'], goals: { calories: 2400 } }).success).toBe(true)
  })

  it('profile and the profile patch accept nutrition settings; a profile without them still parses', () => {
    const base = { user_id: 'u1', plan: 'free', units: 'lb', weight_increment: 5, created_at: '2026-11-16T00:00:00.000Z', updated_at: '2026-11-16T00:00:00.000Z', deleted_at: null }
    expect(profileSchema.parse(base).nutrition).toBeUndefined()
    expect(profileSchema.parse({ ...base, nutrition: { tracked: ['protein_g'], goals: { protein_g: 160 } } }).nutrition?.goals.protein_g).toBe(160)
    expect(PatchProfileBody.parse({ nutrition: { tracked: ['calories'], goals: {} } }).nutrition?.tracked).toEqual(['calories'])
  })
})

describe('dayTotals', () => {
  const settings = nutritionSettingsSchema.parse({ tracked: ['calories', 'protein_g'], goals: { calories: 2400 } })

  it('sums only present values and leaves null entries out of that nutrient\'s count', () => {
    const t = dayTotals(
      [
        { calories: 680, protein_g: 32 },
        { calories: 150, protein_g: null },
        { calories: null, protein_g: null },
      ] as never,
      settings,
    )
    expect(t.calories).toMatchObject({ total: 830, counted: 2 })
    expect(t.protein_g).toMatchObject({ total: 32, counted: 1 })
  })

  it('left is goal minus total, negative when over, null without a goal', () => {
    const under = dayTotals([{ calories: 830, protein_g: 40 }] as never, settings)
    expect(under.calories).toMatchObject({ goal: 2400, left: 1570 })
    expect(under.protein_g).toMatchObject({ goal: null, left: null })
    const over = dayTotals([{ calories: 2600, protein_g: 0 }] as never, settings)
    expect(over.calories.left).toBe(-200)
  })

  it('rounds sums to one decimal', () => {
    const t = dayTotals([{ calories: 0.1, protein_g: 0.2 }, { calories: 0.2, protein_g: 0.1 }] as never, settings)
    expect(t.calories.total).toBe(0.3)
    expect(t.protein_g.total).toBe(0.3)
  })
})

describe('entries and drafts', () => {
  it('rejects calories above the limit, a bad date and a name that is empty after cleaning', () => {
    expect(nutritionEntryInputSchema.safeParse(entry()).success).toBe(true)
    expect(nutritionEntryInputSchema.safeParse(entry({ calories: 10_001 })).success).toBe(false)
    expect(nutritionEntryInputSchema.safeParse(entry({ calories: -1 })).success).toBe(false)
    expect(nutritionEntryInputSchema.safeParse(entry({ date: '16/11/2026' })).success).toBe(false)
    expect(nutritionEntryInputSchema.safeParse(entry({ date: '2026-02-30' })).success).toBe(false)
    expect(nutritionEntryInputSchema.safeParse(entry({ name: '\u0007​' })).success).toBe(false)
    expect(nutritionEntryInputSchema.safeParse(entry({ source: 'robot' })).success).toBe(false)
  })

  it('strips control and bidi characters from names but keeps ordinary text', () => {
    expect(nutritionEntryInputSchema.parse(entry({ name: 'Ch\u0007icken‮ burrito' })).name).toBe('Chicken burrito')
    expect(nutritionEntryInputSchema.parse(entry({ name: 'Dr.Pepper 1.5 oz' })).name).toBe('Dr.Pepper 1.5 oz')
  })

  it('a draft is a name, a quantity and the seven nutrients, each a number or null', () => {
    expect(mealDraftSchema.safeParse({ name: 'Yogurt', quantity: '1 cup', calories: 150, protein_g: 12, carbs_g: null, fat_g: null, fiber_g: null, sugar_g: null, sodium_mg: null }).success).toBe(true)
    expect(mealDraftSchema.safeParse({ name: 'Yogurt', quantity: '1 cup', calories: '150', protein_g: 12, carbs_g: null, fat_g: null, fiber_g: null, sugar_g: null, sodium_mg: null }).success).toBe(false)
  })

  it('the entry and parse request bodies are bounded', () => {
    expect(PutNutritionEntryBody.safeParse(entry()).success).toBe(true)
    expect(ParseMealBody.parse({ text: '  1 chicken burrito  ' }).text).toBe('1 chicken burrito')
    expect(ParseMealBody.safeParse({ text: '   ' }).success).toBe(false)
    expect(ParseMealBody.safeParse({ text: 'x'.repeat(501) }).success).toBe(false)
  })
})

describe('isNutritionDate', () => {
  const today = '2026-11-16'
  it('accepts one year back and two days ahead, rejects further and impossible dates', () => {
    expect(isNutritionDate('2025-11-16', today)).toBe(true)
    expect(isNutritionDate('2025-11-15', today)).toBe(false)
    expect(isNutritionDate('2026-11-18', today)).toBe(true)
    expect(isNutritionDate('2026-11-19', today)).toBe(false)
    expect(isNutritionDate('2093-01-01', today)).toBe(false)
    expect(isNutritionDate('2026-02-30', today)).toBe(false)
    expect(isNutritionDate('not a date', today)).toBe(false)
  })
})

describe('entitlements', () => {
  it('free and pro can ai_nutrition with limits 30 and 100', () => {
    expect(can({ plan: 'free' }, 'ai_nutrition')).toBe(true)
    expect(can({ plan: 'pro' }, 'ai_nutrition')).toBe(true)
    expect(limit({ plan: 'free' }, 'aiMealsPerDay')).toBe(30)
    expect(limit({ plan: 'pro' }, 'aiMealsPerDay')).toBe(100)
  })
})

describe('export', () => {
  it('an export without nutrition_entries still parses', () => {
    const profile = { user_id: 'u1', plan: 'free', units: 'lb', weight_increment: 5, display_name: null, created_at: '2026-11-16T00:00:00.000Z', updated_at: '2026-11-16T00:00:00.000Z', deleted_at: null }
    const base = { version: 1, exported_at: '2026-11-16T00:00:00.000Z', profile, gear: [], exercises: [], plans: [], plan_days: [], plan_items: [], progression_rules: [], item_states: [], workout_sessions: [], set_logs: [] }
    expect(exportDataSchema.safeParse(base).success).toBe(true)
    expect(exportDataSchema.safeParse({ ...base, nutrition_entries: [] }).success).toBe(true)
  })
})
