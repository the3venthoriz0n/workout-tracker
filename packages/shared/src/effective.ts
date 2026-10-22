import type { Exercise, PlanItem } from './schemas.js'

export type Effective = {
  sets: number
  baseReps: number
  baseWeight: number
  targetReps: number
  targetWeight: number
}

// `??` not `||`: 0 is a valid override
export function effectiveValues(
  item: Pick<PlanItem, 'sets' | 'reps' | 'weight' | 'target_reps' | 'target_weight'>,
  exercise: Pick<Exercise, 'default_sets' | 'default_reps' | 'default_weight'>,
): Effective {
  const baseReps = item.reps ?? exercise.default_reps
  const baseWeight = item.weight ?? exercise.default_weight
  return {
    sets: item.sets ?? exercise.default_sets,
    baseReps,
    baseWeight,
    targetReps: item.target_reps ?? baseReps,
    targetWeight: item.target_weight ?? baseWeight,
  }
}

export function isExerciseAvailable(
  exercise: Pick<Exercise, 'active' | 'required_gear_ids'>,
  ownedGearIds: ReadonlySet<string>,
): boolean {
  return exercise.active && exercise.required_gear_ids.every((id) => ownedGearIds.has(id))
}
