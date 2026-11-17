import { describe, expect, it } from 'vitest'
import { parseGoal, showGoal } from '@/lib/nutrition-goal-text'

describe('parseGoal', () => {
  it.each([
    ['190', { min: null, max: 190 }],
    ['170-190', { min: 170, max: 190 }],
    ['170 - 190 g', { min: 170, max: 190 }],
    ['170–190', { min: 170, max: 190 }],
    ['170 to 190', { min: 170, max: 190 }],
    ['1,5-2,5', { min: 1.5, max: 2.5 }],
    ['', null],
    ['  ', null],
  ])('reads %j', (text, want) => expect(parseGoal(text, 'g')).toEqual(want))

  it.each(['abc', '190-170', '0-5', '-5', '170-', '1-2-3', '190 mg'])('rejects %j', (text) => expect(parseGoal(text, 'g')).toBeUndefined())

  it('reads a unit suffix only for its own unit', () => {
    expect(parseGoal('2400 kcal', 'kcal')).toEqual({ min: null, max: 2400 })
    expect(parseGoal('2000-2400kcal', 'kcal')).toEqual({ min: 2000, max: 2400 })
  })
  it('shows a goal the way it is typed', () => {
    expect(showGoal({ min: 170, max: 190 })).toBe('170-190')
    expect(showGoal({ min: null, max: 190 })).toBe('190')
    expect(showGoal(null)).toBe('')
  })
})
