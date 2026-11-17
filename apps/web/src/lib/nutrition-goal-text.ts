// A goal is typed as one number ("190") or a range ("170-190"). The number is the top of the range.
export type GoalValue = { min: number | null; max: number }

const NUM = String.raw`(\d+(?:[.,]\d+)?)`
const RANGE = new RegExp(String.raw`^${NUM}\s*(?:-|–|—|to)\s*${NUM}$`, 'i')
const SINGLE = new RegExp(String.raw`^${NUM}$`)
const num = (s: string) => Number(s.replace(',', '.'))

/** null for empty text (no goal), undefined when it is not a goal, else the goal. A unit suffix such as "g" is ignored. */
export function parseGoal(text: string, unit: string): GoalValue | null | undefined {
  const t = text.trim().replace(new RegExp(String.raw`\s*${unit}$`, 'i'), '')
  if (t === '') return null
  const range = RANGE.exec(t)
  if (range) {
    const [min, max] = [num(range[1]!), num(range[2]!)]
    return min > 0 && min <= max ? { min, max } : undefined
  }
  const single = SINGLE.exec(t)
  return single ? { min: null, max: num(single[1]!) } : undefined
}

export const showGoal = (g: GoalValue | null): string => (g === null ? '' : g.min === null ? String(g.max) : `${g.min}-${g.max}`)
