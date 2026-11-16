import { describe, expect, test } from 'vitest'
import { convertAmount, convertLoad, exerciseRuleContext, exerciseUnit, resolveRule, stepFor } from '../src/index.js'

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
