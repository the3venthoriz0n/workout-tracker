import { describe, expect, it } from 'vitest'
import { defaultRule } from '../src/progression.js'
import { groupProgressionByExercise, inheritedRule, resolveRule } from '../src/rules.js'
import type { RuleInput } from '../src/schemas.js'

const r = (success_amount: number): RuleInput => ({ ...defaultRule(5), success_amount })
const item = r(1)
const ex = r(2)
const prof = r(3)

describe('resolveRule (item ?? exercise ?? profile ?? built-in)', () => {
  it('an item rule is an override', () => {
    expect(resolveRule({ itemRule: item, inherit: false, exerciseRule: ex, profileRule: prof, increment: 5 })).toEqual({
      rule: item,
      source: 'item',
    })
  })
  it('no item rule and not inheriting means no progression (an explicit override)', () => {
    expect(resolveRule({ itemRule: null, inherit: false, exerciseRule: ex, profileRule: prof, increment: 5 })).toEqual({
      rule: null,
      source: 'item',
    })
  })
  it('inheriting falls through exercise, then profile, then the built-in default', () => {
    const base = { itemRule: null, inherit: true, increment: 2.5 }
    expect(resolveRule({ ...base, exerciseRule: ex, profileRule: prof })).toEqual({ rule: ex, source: 'exercise' })
    expect(resolveRule({ ...base, exerciseRule: null, profileRule: prof })).toEqual({ rule: prof, source: 'profile' })
    expect(resolveRule({ ...base, exerciseRule: null, profileRule: undefined })).toEqual({
      rule: defaultRule(2.5),
      source: 'builtin',
    })
  })
  it('a stray item rule still wins even when the inherit flag is set', () => {
    expect(resolveRule({ itemRule: item, inherit: true, exerciseRule: ex, profileRule: prof, increment: 5 }).source).toBe(
      'item',
    )
  })
  it('inheritedRule is the exercise-level effective default', () => {
    expect(inheritedRule(ex, prof, 5)).toEqual({ rule: ex, source: 'exercise' })
    expect(inheritedRule(null, undefined, 5)).toEqual({ rule: defaultRule(5), source: 'builtin' })
  })
})

describe('groupProgressionByExercise', () => {
  const e = (id: string, name: string, default_rule: RuleInput | null = null) => ({ id, name, default_rule })
  const row = (item_id: string, exercise_id: string, ruleSource: 'item' | 'exercise' | 'profile' | 'builtin', rule: RuleInput | null) => ({
    plan_id: 'p',
    plan_name: 'Plan',
    day_id: 'd',
    day_name: 'Day',
    item_id,
    exercise_id,
    exercise_name: exercise_id,
    rule,
    ruleSource,
  })
  it('lists each exercise once by name with its default, overrides and inheriting items', () => {
    const out = groupProgressionByExercise(
      [e('b', 'Bench', ex), e('a', 'Squat')],
      [row('i1', 'a', 'profile', prof), row('i2', 'a', 'item', item), row('i3', 'b', 'exercise', ex), row('i4', 'a', 'item', null)],
      { default_rule: prof, weight_increment: 5 },
    )
    expect(out.map((x) => x.exercise_name)).toEqual(['Bench', 'Squat'])
    expect(out[0]).toMatchObject({ exercise_id: 'b', rule: ex, source: 'exercise', overrides: [], inheriting: [{ item_id: 'i3' }] })
    expect(out[1]).toMatchObject({ exercise_id: 'a', rule: prof, source: 'profile' })
    expect(out[1]?.overrides).toEqual([
      { plan_id: 'p', plan_name: 'Plan', day_id: 'd', day_name: 'Day', item_id: 'i2', rule: item },
      { plan_id: 'p', plan_name: 'Plan', day_id: 'd', day_name: 'Day', item_id: 'i4', rule: null },
    ])
    expect(out[1]?.inheriting).toEqual([{ plan_id: 'p', plan_name: 'Plan', day_id: 'd', day_name: 'Day', item_id: 'i1' }])
  })
})
