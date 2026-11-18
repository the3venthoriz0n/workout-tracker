// Month arithmetic for the nutrition calendar. A day is a `YYYY-MM-DD` string (see nutrition-date.ts);
// everything here goes through UTC so a daylight-saving shift can never move a day.
import { NUTRITION_LIMITS } from '@workout/shared'
import { shiftDate } from '@/lib/nutrition-date'

export type Month = { year: number; month: number } // month is 1 to 12

const pad = (n: number) => String(n).padStart(2, '0')

export const monthOf = (date: string): Month => ({ year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) })
export const monthStart = (m: Month): string => `${m.year}-${pad(m.month)}-01`
const dayCount = (m: Month): number => new Date(Date.UTC(m.year, m.month, 0)).getUTCDate()
export const monthEnd = (m: Month): string => `${m.year}-${pad(m.month)}-${pad(dayCount(m))}`

export function shiftMonth(m: Month, by: number): Month {
  const t = new Date(Date.UTC(m.year, m.month - 1 + by, 1))
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1 }
}

/** Every day of the month, in order. */
export const monthDays = (m: Month): string[] => Array.from({ length: dayCount(m) }, (_, i) => `${m.year}-${pad(m.month)}-${pad(i + 1)}`)

/** Empty cells before the 1st so the grid starts on Sunday (0 when the 1st is a Sunday). */
export const leadingBlanks = (m: Month): number => new Date(Date.UTC(m.year, m.month - 1, 1)).getUTCDay()

export const monthLabel = (m: Month): string =>
  new Date(Date.UTC(m.year, m.month - 1, 1)).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })

/** The first and last day the log accepts: a year back to two days ahead of `today`. */
export const earliestDay = (today: string): string => shiftDate(today, -NUTRITION_LIMITS.daysBack)
export const latestDay = (today: string): string => shiftDate(today, NUTRITION_LIMITS.daysAhead)
export const isOpenDay = (date: string, today: string): boolean => date >= earliestDay(today) && date <= latestDay(today)

/** Whether the month before or after `m` still holds a day the log accepts. */
export const hasPrevMonth = (m: Month, today: string): boolean => monthEnd(shiftMonth(m, -1)) >= earliestDay(today)
export const hasNextMonth = (m: Month, today: string): boolean => monthStart(shiftMonth(m, 1)) <= latestDay(today)

/** A day spelled out for a screen reader: "Monday, November 10, 2026". */
export const longDate = (date: string): string =>
  new Date(`${date}T00:00:00.000Z`).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })

/** Weekday names, Sunday first: short for show, long for a screen reader. */
export const weekdays = (): { short: string; long: string }[] =>
  Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.UTC(2023, 0, 1 + i)) // 2023-01-01 was a Sunday
    return {
      short: d.toLocaleDateString(undefined, { weekday: 'narrow', timeZone: 'UTC' }),
      long: d.toLocaleDateString(undefined, { weekday: 'long', timeZone: 'UTC' }),
    }
  })
