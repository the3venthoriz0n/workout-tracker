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
