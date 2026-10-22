import { describe, expect, it } from 'vitest'
import { defaultRule, progress } from '../src/progression.js'

const base = { targetReps: 5, targetWeight: 100, baseReps: 5, plannedSets: 3 }
const hit = { done: true, actual_reps: 5, weight: 100 }
const addW = { success_action: 'add_weight' as const, success_amount: 5, fail_streak_limit: 3, deload_pct: 10, rep_ceiling: null }

describe('progress', () => {
  it('skips without a rule', () =>
    expect(progress(base, null, 0, [hit, hit, hit], 5)).toEqual({ targetReps: 5, targetWeight: 100, failStreak: 0, outcome: 'skipped' }))
  it('skips when no set is done', () =>
    expect(progress(base, addW, 1, [{ ...hit, done: false }], 5).outcome).toBe('skipped'))
  it('adds weight on success and resets streak', () =>
    expect(progress(base, addW, 2, [hit, hit, hit], 5)).toEqual({ targetReps: 5, targetWeight: 105, failStreak: 0, outcome: 'success' }))
  it('treats a short session as a miss', () =>
    expect(progress(base, addW, 0, [hit, hit], 5)).toMatchObject({ targetWeight: 100, failStreak: 1, outcome: 'miss' }))
  it('treats a lighter weight as a miss', () =>
    expect(progress(base, addW, 0, [hit, hit, { ...hit, weight: 95 }], 5).outcome).toBe('miss'))
  it('extra reps still succeed', () =>
    expect(progress(base, addW, 0, [hit, hit, { ...hit, actual_reps: 7 }], 5).outcome).toBe('success'))
  it('deloads at the streak limit, rounded', () =>
    expect(progress({ ...base, targetReps: 6 }, addW, 2, [{ ...hit, actual_reps: 3 }], 5)).toEqual({ targetReps: 5, targetWeight: 90, failStreak: 0, outcome: 'deload' }))
  it('deload rounds to the increment', () =>
    expect(progress({ ...base, targetWeight: 62.5 }, addW, 2, [{ ...hit, actual_reps: 1, weight: 62.5 }], 2.5).targetWeight).toBe(57.5))
  it('adds reps', () =>
    expect(progress(base, { ...addW, success_action: 'add_reps', success_amount: 1 }, 0, [hit, hit, hit], 5)).toMatchObject({ targetReps: 6, targetWeight: 100 }))
  it('double progression at the ceiling', () => {
    const rule = { ...addW, success_action: 'add_reps' as const, success_amount: 1, rep_ceiling: 8 }
    const at8 = { ...hit, actual_reps: 8 }
    expect(progress({ ...base, targetReps: 8 }, rule, 0, [at8, at8, at8], 5)).toMatchObject({ targetReps: 5, targetWeight: 105, outcome: 'success' })
  })
  it('never goes below zero', () =>
    expect(progress({ ...base, targetWeight: 0 }, { ...addW, fail_streak_limit: 1 }, 0, [{ ...hit, actual_reps: 0, weight: 0 }], 5).targetWeight).toBe(0))
})

describe('defaultRule', () => {
  it('uses the increment', () =>
    expect(defaultRule(2.5)).toEqual({ success_action: 'add_weight', success_amount: 2.5, fail_streak_limit: 3, deload_pct: 10, rep_ceiling: null }))
  it('rounds add_weight success to the increment after a unit conversion', () =>
    expect(progress({ ...base, targetWeight: 45.4 }, { ...addW, success_amount: 2.5 }, 0, [{ ...hit, weight: 45.4 }, { ...hit, weight: 45.4 }, { ...hit, weight: 45.4 }], 2.5).targetWeight).toBe(47.5))
  it('rounds the double-progression weight bump to the increment', () => {
    const rule = { ...addW, success_action: 'add_reps' as const, success_amount: 1, rep_ceiling: 8 }
    const at8 = { ...hit, actual_reps: 8, weight: 45.4 }
    expect(progress({ ...base, targetReps: 8, targetWeight: 45.4 }, rule, 0, [at8, at8, at8], 2.5).targetWeight).toBe(47.5)
  })
  it('leaves aligned weights exact', () =>
    expect(progress(base, addW, 0, [hit, hit, hit], 5).targetWeight).toBe(105))
  describe('add_weight steps are at least one increment', () => {
    const ok = (w: number) => ({ done: true, actual_reps: 5, weight: w })
    const run = (w: number, amount: number, inc: number) =>
      progress({ ...base, targetWeight: w }, { ...addW, success_amount: amount }, 0, [ok(w), ok(w), ok(w)], inc).targetWeight
    it('increment 5, amount 2 from 100 -> 105', () => expect(run(100, 2, 5)).toBe(105))
    it('increment 5, amount 2.5 from 100 -> 105', () => expect(run(100, 2.5, 5)).toBe(105))
    it('increment 5, amount 5 from 100 -> 105', () => expect(run(100, 5, 5)).toBe(105))
    it('increment 2.5, amount 2.5 from 100 -> 102.5', () => expect(run(100, 2.5, 2.5)).toBe(102.5))
    it('off-grid 62.5 @5 amount 5 -> 70 (half-up)', () => expect(run(62.5, 5, 5)).toBe(70))
    it('increment 2.5, amount 1 from 45.4 -> 47.5', () => expect(run(45.4, 1, 2.5)).toBe(47.5))
  })
})
