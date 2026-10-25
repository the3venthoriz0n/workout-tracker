import type { DayColor } from '@workout/shared'
import { useQueries } from '@tanstack/react-query'
import { dayColorOf } from '@/lib/day-colors'
import { planQueryOptions, usePlans } from '@/repo/hooks'
import { useRepo } from '@/repo/provider'

/**
 * Colour of every live plan day by id. Sessions only snapshot the day name, so Today and History
 * look the colour up here; a deleted day has none (its name is still shown).
 */
export function useDayColors(): Map<string, DayColor> {
  const repo = useRepo()
  const plans = usePlans().data ?? []
  const trees = useQueries({ queries: plans.map((p) => planQueryOptions(repo, p.id)) })
  const map = new Map<string, DayColor>()
  for (const t of trees) for (const d of t.data?.days ?? []) map.set(d.id, dayColorOf(d))
  return map
}
