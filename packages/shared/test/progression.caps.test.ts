import { describe, expect, it } from 'vitest'
import { progress } from '../src/progression.js'

// 45 lb dumbbells: the heaviest this exercise can be loaded
const input = (over: Record<string, number | null> = {}) => ({ targetReps: 8, targetWeight: 40, baseReps: 8, plannedSets: 3, maxWeight: 45, ...over })
const sets = (weight: number, reps = 8) => Array.from({ length: 3 }, () => ({ done: true, actual_reps: reps, weight }))
const addW = { success_action: 'add_weight' as const, success_amount: 5, fail_streak_limit: 3, deload_pct: 10, rep_ceiling: null }
const addR = { ...addW, success_action: 'add_reps' as const, success_amount: 1 }

describe('progress with a weight limit', () => {
  it('no limit behaves as before', () => {
    expect(progress(input({ maxWeight: null }), addW, 0, sets(40), 5)).toMatchObject({ targetWeight: 45, targetReps: 8 })
    const { maxWeight: _drop, ...none } = input()
    expect(progress(none, addW, 0, sets(40), 5)).toMatchObject({ targetWeight: 45, targetReps: 8 })
  })
  it('one step below the limit still adds weight', () =>
    expect(progress(input(), addW, 0, sets(40), 5)).toMatchObject({ targetWeight: 45, targetReps: 8, outcome: 'success' }))
  it('a step that would pass the limit stops at it', () =>
    expect(progress(input({ targetWeight: 43 }), addW, 0, sets(43), 1)).toMatchObject({ targetWeight: 45, targetReps: 8 }))
  it('at the limit it adds a rep instead of weight', () =>
    expect(progress(input({ targetWeight: 45 }), addW, 0, sets(45), 5)).toMatchObject({ targetWeight: 45, targetReps: 9, outcome: 'success', liftedWeight: 45 }))
  it('keeps adding reps each success while at the limit', () => {
    let r = progress(input({ targetWeight: 45 }), addW, 0, sets(45), 5)
    r = progress(input({ targetWeight: 45, targetReps: r.targetReps }), addW, 0, sets(45, r.targetReps), 5)
    expect(r).toMatchObject({ targetWeight: 45, targetReps: 10 })
  })
  it('stops adding reps at the rep ceiling and holds', () => {
    const rule = { ...addW, rep_ceiling: 10 }
    expect(progress(input({ targetWeight: 45, targetReps: 10 }), rule, 0, sets(45, 10), 5)).toMatchObject({ targetWeight: 45, targetReps: 10, failStreak: 0, outcome: 'success' })
    expect(progress(input({ targetWeight: 45, targetReps: 9 }), rule, 0, sets(45, 9), 5)).toMatchObject({ targetReps: 10 })
  })
  it('a weight already above the limit (lifted by hand) is not clamped, and adds reps', () =>
    expect(progress(input({ targetWeight: 45 }), addW, 0, sets(50), 5)).toMatchObject({ targetWeight: 50, targetReps: 9 }))
  it('double progression resets reps and adds weight when there is room', () => {
    const rule = { ...addR, rep_ceiling: 8 }
    expect(progress(input({ targetReps: 8, baseReps: 5 }), rule, 0, sets(40), 5)).toMatchObject({ targetReps: 5, targetWeight: 45 })
  })
  it('double progression at the limit and the ceiling holds', () => {
    const rule = { ...addR, rep_ceiling: 8 }
    expect(progress(input({ targetReps: 8, baseReps: 5, targetWeight: 45 }), rule, 0, sets(45), 5)).toMatchObject({ targetReps: 8, targetWeight: 45, outcome: 'success' })
  })
  it('double progression whose next step passes the limit stops at it', () => {
    const rule = { ...addR, rep_ceiling: 8 }
    expect(progress(input({ targetReps: 8, baseReps: 5, targetWeight: 43 }), rule, 0, sets(43), 5)).toMatchObject({ targetReps: 5, targetWeight: 45 })
  })
  it('add reps without a ceiling ignores the limit', () =>
    expect(progress(input({ targetWeight: 45 }), addR, 0, sets(45), 5)).toMatchObject({ targetReps: 9, targetWeight: 45 }))
  it('a miss and a deload work as before, and the climb back stops at the limit', () => {
    expect(progress(input({ targetWeight: 45 }), addW, 0, [{ done: true, actual_reps: 3, weight: 45 }], 5)).toMatchObject({ outcome: 'miss', failStreak: 1 })
    expect(progress(input({ targetWeight: 45, targetReps: 10 }), addW, 2, [{ done: true, actual_reps: 3, weight: 45 }], 5)).toMatchObject({
      outcome: 'deload',
      targetWeight: 40,
      targetReps: 8,
    })
    expect(progress(input({ targetWeight: 40 }), addW, 0, sets(40), 5)).toMatchObject({ targetWeight: 45 })
  })
})
