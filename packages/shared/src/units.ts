import { LIMITS } from './schemas.js'

export type Units = 'lb' | 'kg'

export const DEFAULT_INCREMENT: Record<Units, number> = { lb: 5, kg: 2.5 }

export const KG_PER_LB = 0.45359237

export function roundToIncrement(weight: number, increment: number): number {
  const rounded = Math.round(weight / increment) * increment
  return Math.max(0, Math.round(rounded * 1000) / 1000)
}

export function convertWeight(weight: number, from: Units, to: Units): number {
  if (from === to) return weight
  const converted = from === 'lb' ? weight * KG_PER_LB : weight / KG_PER_LB
  // Stay inside the storable range (LIMITS.weight) so a conversion can never lock an account.
  return Math.min(LIMITS.weight, Math.round(converted * 10) / 10)
}

/** The unit an exercise's weights are in: its own override, else the app unit. */
export function exerciseUnit(exercise: { unit?: Units | null | undefined }, appUnits: Units): Units {
  return exercise.unit ?? appUnits
}

/** The progression step for weights in `unit`: the profile's own step in the app unit, else that unit's default. */
export function stepFor(unit: Units, profile: { units: Units; weight_increment: number }): number {
  return unit === profile.units ? profile.weight_increment : DEFAULT_INCREMENT[unit]
}

/** How finely a converted load is snapped: fine enough that common weights come back exactly. */
const LOAD_SNAP: Record<Units, number> = { lb: 1, kg: 0.5 }

/**
 * A load moved from one unit to another, snapped to a half kilo or a whole pound so there is no
 * 102.058 kg, and so flipping back lands where it started (225 lb is 102 kg is 225 lb; 135, 95 and
 * 315 return exactly too). Zero stays zero; anything else is at least one snap.
 */
export function convertLoad(weight: number, from: Units, to: Units): number {
  if (from === to || weight === 0) return weight
  const snap = LOAD_SNAP[to]
  return Math.min(LIMITS.weight, Math.max(snap, roundToIncrement(convertWeight(weight, from, to), snap)))
}

/** A rule's "add weight" amount moved between units: the step maps to the step, anything else is snapped. */
export function convertAmount(amount: number, from: Units, to: Units, fromStep: number, toStep: number): number {
  if (from === to) return amount
  if (amount === fromStep) return toStep
  return Math.min(LIMITS.weight, Math.max(toStep, roundToIncrement(convertWeight(amount, from, to), toStep)))
}

/**
 * A gear limit (stored in the app unit) expressed in `to`, rounded DOWN to the same snap as loads so a
 * converted limit never allows more than the equipment does (45 lb is 20 kg, not 20.5).
 */
export function convertLimit(limit: number, from: Units, to: Units): number {
  if (from === to) return limit
  const snap = LOAD_SNAP[to]
  return Math.max(snap, Math.floor(convertWeight(limit, from, to) / snap + 1e-9) * snap)
}

/**
 * The heaviest weight an exercise can be loaded to, in the exercise's own unit: the lowest limit among
 * its required gear (the weakest piece decides), or null when none of it has one.
 */
export function effectiveMaxWeight(
  gearLimits: readonly (number | null | undefined)[],
  appUnits: Units,
  exUnit: Units,
): number | null {
  const set = gearLimits.filter((m): m is number => typeof m === 'number')
  if (set.length === 0) return null
  return convertLimit(Math.min(...set), appUnits, exUnit)
}

// null = empty input, undefined = invalid
export function parseWeight(text: string): number | null | undefined {
  const t = text.trim().replace(',', '.')
  if (t === '') return null
  if (!/^(\d+\.?\d*|\.\d+)$/.test(t)) return undefined
  const n = Number(t)
  return Number.isFinite(n) ? n : undefined
}

export function parseReps(text: string): number | null | undefined {
  const t = text.trim()
  if (t === '') return null
  if (!/^\d+$/.test(t)) return undefined
  const n = Number(t)
  return Number.isSafeInteger(n) ? n : undefined
}
