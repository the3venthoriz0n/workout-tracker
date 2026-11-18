import { describe, expect, test } from 'vitest'
import { gearSchema, convertAmount, convertLimit, convertLoad, effectiveMaxWeight, exerciseRuleContext, exerciseUnit, resolveRule, stepFor } from '../src/index.js'

const profile = { units: 'lb' as const, weight_increment: 5 }

describe('per-exercise units', () => {
  test('an exercise follows the app unit unless it has its own', () => {
    expect(exerciseUnit({ unit: null }, 'lb')).toBe('lb')
    expect(exerciseUnit({}, 'kg')).toBe('kg')
    expect(exerciseUnit({ unit: 'kg' }, 'lb')).toBe('kg')
  })

  test('the step is the profile step in the app unit and the unit default in the other', () => {
    expect(stepFor('lb', { units: 'lb', weight_increment: 10 })).toBe(10)
    expect(stepFor('kg', { units: 'lb', weight_increment: 10 })).toBe(2.5)
    expect(stepFor('lb', { units: 'kg', weight_increment: 1.25 })).toBe(5)
  })

  test('loads convert to a plate-friendly step and round-trip', () => {
    expect(convertLoad(225, 'lb', 'kg')).toBe(102)
    expect(convertLoad(102, 'kg', 'lb')).toBe(225)
    for (const lb of [45, 95, 135, 185, 225, 275, 315]) {
      expect(convertLoad(convertLoad(lb, 'lb', 'kg'), 'kg', 'lb')).toBe(lb)
    }
    expect(convertLoad(0, 'lb', 'kg')).toBe(0)
    expect(convertLoad(5, 'lb', 'kg')).toBe(2.5)
    expect(convertLoad(100, 'lb', 'lb')).toBe(100)
  })

  test('a rule amount equal to the step maps to the other step; others snap', () => {
    expect(convertAmount(5, 'lb', 'kg', 5, 2.5)).toBe(2.5)
    expect(convertAmount(10, 'lb', 'kg', 5, 2.5)).toBe(5)
    expect(convertAmount(2.5, 'kg', 'lb', 2.5, 5)).toBe(5)
    expect(convertAmount(1, 'lb', 'kg', 5, 2.5)).toBe(2.5)
  })

  test('the app default rule is converted for an exercise in the other unit; add reps is untouched', () => {
    const rule = { success_action: 'add_weight' as const, success_amount: 10, fail_streak_limit: 3, deload_pct: 10, rep_ceiling: null }
    const kg = exerciseRuleContext({ unit: 'kg' }, { ...profile, default_rule: rule })
    expect(kg.unit).toBe('kg')
    expect(kg.increment).toBe(2.5)
    expect(kg.profileRule?.success_amount).toBe(5)
    const same = exerciseRuleContext({ unit: null }, { ...profile, default_rule: rule })
    expect(same.profileRule?.success_amount).toBe(10)
    const reps = { ...rule, success_action: 'add_reps' as const, success_amount: 1 }
    expect(exerciseRuleContext({ unit: 'kg' }, { ...profile, default_rule: reps }).profileRule).toEqual(reps)
  })

  test('an inheriting item in kg gets the built-in rule at the kg step', () => {
    const ctx = exerciseRuleContext({ unit: 'kg' }, profile)
    const r = resolveRule({ itemRule: null, inherit: true, exerciseRule: null, profileRule: ctx.profileRule, increment: ctx.increment })
    expect(r.source).toBe('builtin')
    expect(r.rule?.success_amount).toBe(2.5)
  })
})

describe('gear limits', () => {
  test('a converted limit never allows more than the equipment does', () => {
    expect(convertLimit(45, 'lb', 'kg')).toBe(20) // 20.4 kg, rounded down to a half kilo
    expect(convertLimit(50, 'lb', 'kg')).toBe(22.5) // 22.7 kg
    expect(convertLimit(20, 'kg', 'lb')).toBe(44) // 44.09 lb, rounded down to a pound
    expect(convertLimit(45, 'lb', 'lb')).toBe(45)
  })

  test('the lowest limit among the required gear decides; none means no limit', () => {
    expect(effectiveMaxWeight([], 'lb', 'lb')).toBeNull()
    expect(effectiveMaxWeight([null, undefined], 'lb', 'lb')).toBeNull()
    expect(effectiveMaxWeight([50, null, 45], 'lb', 'lb')).toBe(45)
    expect(effectiveMaxWeight([50], 'lb', 'kg')).toBe(22.5)
  })
})

describe('gear schema limit', () => {
  const gear = { id: '11111111-1111-4111-8111-111111111111', name: 'Dumbbells', owned: true, user_id: 'u', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', deleted_at: null }
  test('is optional, nullable and positive', () => {
    expect(gearSchema.safeParse(gear).success).toBe(true)
    expect(gearSchema.safeParse({ ...gear, max_weight: null }).success).toBe(true)
    expect(gearSchema.safeParse({ ...gear, max_weight: 45 }).success).toBe(true)
    expect(gearSchema.safeParse({ ...gear, max_weight: 0 }).success).toBe(false)
    expect(gearSchema.safeParse({ ...gear, max_weight: -5 }).success).toBe(false)
    expect(gearSchema.safeParse({ ...gear, max_weight: 'heavy' }).success).toBe(false)
  })
})
