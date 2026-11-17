import type { SessionDetail, Units } from '@workout/shared'
import { formatWeight } from '@/lib/format'

// "5 × 130 lb": the last set marked done for each exercise in a finished session, keyed by
// exercise id. Shown under the exercise heading so the lifter sees what they did last time.
export function lastTimeByExercise(
  previous: SessionDetail | null | undefined,
  unit: Units,
  // Formats a weight in its unit; defaults to "130 lb"
  weightText: (weight: number, unit: Units) => string = (w, u) => `${formatWeight(w)} ${u}`,
): Map<string, string> {
  const out = new Map<string, string>()
  for (const ex of previous?.exercises ?? []) {
    const done = ex.sets.filter((s) => s.done)
    const last = done[done.length - 1]
    // Each exercise is shown in its own unit, whatever the app unit is
    if (last) out.set(ex.exercise_id, `${last.actual_reps} × ${weightText(last.weight, ex.unit ?? unit)}`)
  }
  return out
}
