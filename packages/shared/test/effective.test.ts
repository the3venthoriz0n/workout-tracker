import { describe, expect, it } from 'vitest'
import { effectiveValues, isExerciseAvailable } from '../src/effective.js'

const ex = { default_sets: 3, default_reps: 5, default_weight: 95 }
const none = { sets: null, reps: null, weight: null, target_reps: null, target_weight: null }

describe('effectiveValues', () => {
  it('falls back to exercise defaults', () => {
    expect(effectiveValues(none, ex)).toEqual({ sets: 3, baseReps: 5, baseWeight: 95, targetReps: 5, targetWeight: 95 })
  })
  it('uses item overrides', () => {
    expect(effectiveValues({ ...none, reps: 8, weight: 100 }, ex)).toMatchObject({ baseReps: 8, targetReps: 8, targetWeight: 100 })
  })
  it('prefers targets over base', () => {
    expect(effectiveValues({ ...none, weight: 100, target_weight: 110 }, ex)).toMatchObject({ baseWeight: 100, targetWeight: 110 })
  })
  it('treats 0 as an override, not unset', () => {
    expect(effectiveValues({ ...none, weight: 0 }, ex).targetWeight).toBe(0)
  })
})

describe('isExerciseAvailable', () => {
  it('requires active and all gear owned', () => {
    expect(isExerciseAvailable({ active: true, required_gear_ids: [] }, new Set())).toBe(true)
    expect(isExerciseAvailable({ active: true, required_gear_ids: ['a', 'b'] }, new Set(['a']))).toBe(false)
    expect(isExerciseAvailable({ active: true, required_gear_ids: ['a'] }, new Set(['a']))).toBe(true)
    expect(isExerciseAvailable({ active: false, required_gear_ids: [] }, new Set())).toBe(false)
  })
})
