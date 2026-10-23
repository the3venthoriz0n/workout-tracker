import type { RuleInput, SetLog } from './schemas.js'
import { LIMITS } from './schemas.js'
import { roundToIncrement } from './units.js'

export type Outcome = 'skipped' | 'success' | 'miss' | 'deload'

export function defaultRule(increment: number): RuleInput {
  return { success_action: 'add_weight', success_amount: increment, fail_streak_limit: 3, deload_pct: 10, rep_ceiling: null }
}

export function progress(...args: Parameters<typeof progressRaw>): ReturnType<typeof progressRaw> {
  const r = progressRaw(...args)
  // Targets stay inside the storable range.
  return { ...r, targetReps: Math.min(r.targetReps, LIMITS.reps), targetWeight: Math.min(r.targetWeight, LIMITS.weight) }
}

function progressRaw(
  input: { targetReps: number; targetWeight: number; baseReps: number; plannedSets: number },
  rule: RuleInput | null,
  failStreak: number,
  sets: Pick<SetLog, 'done' | 'actual_reps' | 'weight'>[],
  increment: number,
): { targetReps: number; targetWeight: number; failStreak: number; outcome: Outcome } {
  const { targetReps, targetWeight, baseReps, plannedSets } = input
  const doneSets = sets.filter((s) => s.done)
  if (!rule || doneSets.length === 0) return { targetReps, targetWeight, failStreak, outcome: 'skipped' }

  const success =
    doneSets.length >= plannedSets && doneSets.every((s) => s.actual_reps >= targetReps && s.weight >= targetWeight)

  if (success) {
    let reps = targetReps
    let weight = targetWeight
    if (rule.success_action === 'add_weight') {
      // Snapped to the increment, but never a step smaller than one increment
      const next = roundToIncrement(weight + rule.success_amount, increment)
      weight = next > weight ? next : roundToIncrement(weight + increment, increment)
    } else {
      reps += rule.success_amount
      if (rule.rep_ceiling !== null && reps > rule.rep_ceiling) {
        reps = baseReps
        weight = roundToIncrement(weight + increment, increment)
      }
    }
    return { targetReps: reps, targetWeight: weight, failStreak: 0, outcome: 'success' }
  }

  const streak = failStreak + 1
  if (streak >= rule.fail_streak_limit) {
    const weight = roundToIncrement(targetWeight * (1 - rule.deload_pct / 100), increment)
    return { targetReps: baseReps, targetWeight: weight, failStreak: 0, outcome: 'deload' }
  }
  return { targetReps, targetWeight, failStreak: streak, outcome: 'miss' }
}
