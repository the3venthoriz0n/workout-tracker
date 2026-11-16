// Calendar days for the nutrition log, as `YYYY-MM-DD` strings in the user's local time. A day is
// just that string, so arithmetic goes through UTC midnight and never meets a daylight-saving shift.
import { NUTRITION_LIMITS } from '@workout/shared'

const pad = (n: number) => String(n).padStart(2, '0')

/** The local calendar day of `d` (now by default). */
export function localDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** `date` moved by whole days. */
export function shiftDate(date: string, days: number): string {
  const t = new Date(`${date}T00:00:00.000Z`)
  t.setUTCDate(t.getUTCDate() + days)
  return t.toISOString().slice(0, 10)
}

/** The log reaches back a year and ahead two days, as the server accepts. */
export const canGoPrev = (date: string, today: string): boolean => date > shiftDate(today, -NUTRITION_LIMITS.daysBack)
export const canGoNext = (date: string, today: string): boolean => date < shiftDate(today, NUTRITION_LIMITS.daysAhead)

export function dateLabel(date: string, today: string): string {
  if (date === today) return 'Today'
  if (date === shiftDate(today, -1)) return 'Yesterday'
  if (date === shiftDate(today, 1)) return 'Tomorrow'
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}
