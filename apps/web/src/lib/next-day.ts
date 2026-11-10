// Which plan and day the Today picker preselects: the day after the one in the most recent
// completed workout, wrapping to the first day after the last. Falls back to the first plan's
// first day when there is no history or that day is gone. Only a default: the user can pick any.

type PlanLike = { id: string; days: { id: string }[] }
type SessionLike = { plan_day_id: string; completed_at: string | null }

export function nextDay(plans: PlanLike[], sessions: SessionLike[]): { planId: string; dayId: string } {
  let latest: SessionLike | null = null
  for (const s of sessions) {
    if (s.completed_at !== null && (latest === null || s.completed_at > latest.completed_at!)) latest = s
  }
  if (latest) {
    for (const p of plans) {
      const at = p.days.findIndex((d) => d.id === latest.plan_day_id)
      if (at !== -1) return { planId: p.id, dayId: p.days[(at + 1) % p.days.length]!.id }
    }
  }
  const first = plans[0]!
  return { planId: first.id, dayId: first.days[0]!.id }
}
