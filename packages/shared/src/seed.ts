import type { ExerciseInput } from './schemas.js'
import type { Units } from './units.js'
import { DEFAULT_INCREMENT, convertWeight, roundToIncrement } from './units.js'

export const SEED_GEAR: readonly string[] = [
  'Barbell',
  'Dumbbells',
  'Bench',
  'Squat rack',
  'Pull-up bar',
  'Cable machine',
  'Kettlebell',
  'Resistance bands',
]

type SeedExercise = {
  name: string
  gear: readonly string[]
  sets: number
  reps: number
  lb: number
}

const SEED_EXERCISES: readonly SeedExercise[] = [
  { name: 'Back Squat', gear: ['Barbell', 'Squat rack'], sets: 3, reps: 5, lb: 95 },
  { name: 'Bench Press', gear: ['Barbell', 'Bench'], sets: 3, reps: 5, lb: 95 },
  { name: 'Deadlift', gear: ['Barbell'], sets: 1, reps: 5, lb: 135 },
  { name: 'Overhead Press', gear: ['Barbell'], sets: 3, reps: 5, lb: 65 },
  { name: 'Barbell Row', gear: ['Barbell'], sets: 3, reps: 8, lb: 65 },
  { name: 'Romanian Deadlift', gear: ['Barbell'], sets: 3, reps: 8, lb: 95 },
  { name: 'Dumbbell Bench Press', gear: ['Dumbbells', 'Bench'], sets: 3, reps: 10, lb: 30 },
  { name: 'Dumbbell Fly', gear: ['Dumbbells', 'Bench'], sets: 3, reps: 12, lb: 15 },
  { name: 'Dumbbell Row', gear: ['Dumbbells'], sets: 3, reps: 10, lb: 30 },
  { name: 'Goblet Squat', gear: ['Dumbbells'], sets: 3, reps: 10, lb: 35 },
  { name: 'Pull-up', gear: ['Pull-up bar'], sets: 3, reps: 5, lb: 0 },
  { name: 'Lat Pulldown', gear: ['Cable machine'], sets: 3, reps: 10, lb: 70 },
  { name: 'Kettlebell Swing', gear: ['Kettlebell'], sets: 3, reps: 15, lb: 35 },
  { name: 'Band Pull-apart', gear: ['Resistance bands'], sets: 3, reps: 15, lb: 0 },
  { name: 'Push-up', gear: [], sets: 3, reps: 10, lb: 0 },
  { name: 'Bodyweight Squat', gear: [], sets: 3, reps: 15, lb: 0 },
]

export function seedExercises(
  units: Units,
  gearIdsByName: ReadonlyMap<string, string>,
): Omit<ExerciseInput, 'id'>[] {
  return SEED_EXERCISES.map((seed) => ({
    name: seed.name,
    notes: '',
    video_url: null,
    required_gear_ids: seed.gear.map((gear) => {
      const id = gearIdsByName.get(gear)
      if (id === undefined) throw new Error(`Seed gear missing: ${gear}`)
      return id
    }),
    active: true,
    default_sets: seed.sets,
    default_reps: seed.reps,
    default_weight: roundToIncrement(
      convertWeight(seed.lb, 'lb', units),
      DEFAULT_INCREMENT[units],
    ),
  }))
}
