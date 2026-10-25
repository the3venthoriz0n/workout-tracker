import { DAY_COLORS, type DayColor } from '@workout/shared'

export const DAY_COLOR_NAMES: Record<DayColor, string> = {
  blue: 'Blue',
  red: 'Red',
  green: 'Green',
  amber: 'Amber',
  violet: 'Violet',
  teal: 'Teal',
  pink: 'Pink',
  slate: 'Slate',
}

/** A day's colour: the stored one, else derived from its position (spec §5 plan_day.color). */
export function dayColorOf(day: { color: DayColor | null; position: number }): DayColor {
  return day.color ?? DAY_COLORS[day.position % DAY_COLORS.length]!
}

/** CSS colour for a palette entry (tokens in index.css, per light/dark theme). */
export const dayColorVar = (c: DayColor) => `var(--day-${c})`
