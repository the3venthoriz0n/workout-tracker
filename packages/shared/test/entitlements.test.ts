import { describe, expect, it } from 'vitest'
import { ENTITLEMENTS, can, limit } from '../src/index.js'

describe('entitlements', () => {
  it('free plan', () => {
    expect(can({ plan: 'free' }, 'charts')).toBe(true)
    expect(can({ plan: 'free' }, 'ai_plan')).toBe(false)
    expect(limit({ plan: 'free' }, 'maxPlans')).toBe(Infinity)
    expect(ENTITLEMENTS.free).toEqual({ maxPlans: Infinity, aiPlansPerDay: 0, charts: true })
  })
  it('pro plan can use AI plans', () => {
    expect(can({ plan: 'pro' }, 'ai_plan')).toBe(true)
    expect(limit({ plan: 'pro' }, 'aiPlansPerDay')).toBeGreaterThan(0)
  })
})
