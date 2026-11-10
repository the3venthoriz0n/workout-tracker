import { describe, expect, test } from 'vitest'
import { nextDay } from '../src/lib/next-day'

const plan = (id: string, days: string[]) => ({ id, days: days.map((d) => ({ id: d })) })
const done = (plan_day_id: string, completed_at: string) => ({ plan_day_id, completed_at })

const ppl = plan('ppl', ['push', 'pull', 'legs'])
const other = plan('other', ['x', 'y'])

describe('nextDay', () => {
  test('no history: the first plan and its first day', () => {
    expect(nextDay([ppl, other], [])).toEqual({ planId: 'ppl', dayId: 'push' })
  })
  test('after day A, day B', () => {
    expect(nextDay([ppl, other], [done('push', '2026-11-01T10:00:00Z')])).toEqual({ planId: 'ppl', dayId: 'pull' })
  })
  test('after the last day, wraps to the first', () => {
    expect(nextDay([ppl], [done('legs', '2026-11-01T10:00:00Z')])).toEqual({ planId: 'ppl', dayId: 'push' })
  })
  test('uses the most recent completed session, whatever the list order', () => {
    const sessions = [done('push', '2026-10-01T10:00:00Z'), done('pull', '2026-11-02T10:00:00Z'), done('legs', '2026-10-15T10:00:00Z')]
    expect(nextDay([ppl], sessions)).toEqual({ planId: 'ppl', dayId: 'legs' })
  })
  test('switches to the plan of the latest session', () => {
    expect(nextDay([ppl, other], [done('x', '2026-11-01T10:00:00Z')])).toEqual({ planId: 'other', dayId: 'y' })
  })
  test('a single-day plan stays on that day', () => {
    expect(nextDay([plan('solo', ['only'])], [done('only', '2026-11-01T10:00:00Z')])).toEqual({ planId: 'solo', dayId: 'only' })
  })
  test('latest session from a deleted or empty day falls back to the first plan and day', () => {
    expect(nextDay([ppl, other], [done('gone', '2026-11-01T10:00:00Z'), done('push', '2026-10-01T10:00:00Z')])).toEqual({
      planId: 'ppl',
      dayId: 'push',
    })
  })
  test('ignores sessions that are not completed', () => {
    expect(nextDay([ppl], [{ plan_day_id: 'push', completed_at: null }])).toEqual({ planId: 'ppl', dayId: 'push' })
  })
})
