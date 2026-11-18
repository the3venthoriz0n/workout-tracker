import { describe, expect, it } from 'vitest'
import {
  earliestDay,
  hasNextMonth,
  hasPrevMonth,
  isOpenDay,
  latestDay,
  leadingBlanks,
  longDate,
  monthDays,
  monthEnd,
  monthOf,
  monthStart,
  shiftMonth,
  weekdays,
} from '../src/lib/nutrition-calendar'

describe('month arithmetic', () => {
  it('reads a month from a day and spans it', () => {
    expect(monthOf('2026-11-17')).toEqual({ year: 2026, month: 11 })
    expect(monthStart({ year: 2026, month: 2 })).toBe('2026-02-01')
    expect(monthEnd({ year: 2026, month: 2 })).toBe('2026-02-28')
    expect(monthEnd({ year: 2028, month: 2 })).toBe('2028-02-29') // leap year
    expect(monthEnd({ year: 2026, month: 12 })).toBe('2026-12-31')
    const days = monthDays({ year: 2026, month: 11 })
    expect(days).toHaveLength(30)
    expect(days[0]).toBe('2026-11-01')
    expect(days.at(-1)).toBe('2026-11-30')
  })
  it('moves by months across a year', () => {
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 })
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 })
    expect(shiftMonth({ year: 2026, month: 3 }, -14)).toEqual({ year: 2025, month: 1 })
  })
  it('pads the first week so the grid starts on Sunday', () => {
    expect(leadingBlanks({ year: 2026, month: 11 })).toBe(0) // Nov 1 2026 is a Sunday
    expect(leadingBlanks({ year: 2026, month: 12 })).toBe(2) // Dec 1 2026 is a Tuesday
    expect(leadingBlanks({ year: 2027, month: 1 })).toBe(5) // Jan 1 2027 is a Friday
  })
  it('names the days of the week Sunday first, short and long', () => {
    const names = weekdays()
    expect(names).toHaveLength(7)
    expect(new Set(names.map((n) => n.long)).size).toBe(7)
    expect(names[0]!.long.toLowerCase()).toContain('sun')
    expect(longDate('2026-11-17')).toContain('2026')
  })
})

describe('the days the log accepts', () => {
  const today = '2026-11-17'
  it('is a year back to two days ahead', () => {
    expect(earliestDay(today)).toBe('2025-11-17')
    expect(latestDay(today)).toBe('2026-11-19')
    expect(isOpenDay('2025-11-17', today)).toBe(true)
    expect(isOpenDay('2025-11-16', today)).toBe(false)
    expect(isOpenDay('2026-11-19', today)).toBe(true)
    expect(isOpenDay('2026-11-20', today)).toBe(false)
  })
  it('stops month navigation at the edges', () => {
    expect(hasPrevMonth({ year: 2025, month: 12 }, today)).toBe(true) // November 2025 still holds the 17th to the 30th
    expect(hasPrevMonth({ year: 2025, month: 11 }, today)).toBe(false)
    expect(hasNextMonth({ year: 2026, month: 11 }, today)).toBe(false)
    expect(hasNextMonth({ year: 2026, month: 10 }, today)).toBe(true)
    // Two days ahead can reach into the next month
    expect(hasNextMonth({ year: 2026, month: 11 }, '2026-11-29')).toBe(true)
  })
})
