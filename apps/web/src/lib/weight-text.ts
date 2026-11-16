import { convertLoad, type Units } from '@workout/shared'
import { formatWeight } from '@/lib/format'
import { useShowBothUnits } from '@/lib/show-both-units-pref'

export const otherUnit = (u: Units): Units => (u === 'lb' ? 'kg' : 'lb')

/** "225 lb", or "225 lb · 102 kg" when both units are on. The second figure is a display conversion only. */
export function weightText(weight: number, unit: Units, both: boolean): string {
  const main = `${formatWeight(weight)} ${unit}`
  if (!both) return main
  const other = otherUnit(unit)
  return `${main} · ${formatWeight(convertLoad(weight, unit, other))} ${other}`
}

/** The formatter for the current "show both units" setting. */
export function useWeightText(): (weight: number, unit: Units) => string {
  const both = useShowBothUnits()
  return (weight, unit) => weightText(weight, unit, both)
}
