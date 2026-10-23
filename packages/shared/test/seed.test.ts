import { describe, expect, it } from 'vitest'
import { exerciseInputSchema, newId, seedExercises, SEED_GEAR } from '../src/index.js'

const gearIds = new Map(SEED_GEAR.map((name) => [name, newId()]))

describe('seedExercises', () => {
  it('creates 16 starter exercises', () => {
    expect(seedExercises('lb', gearIds)).toHaveLength(16)
  })

  it('produces inputs that pass the exercise schema', () => {
    for (const exercise of seedExercises('kg', gearIds)) {
      expect(exerciseInputSchema.safeParse({ id: newId(), ...exercise }).success).toBe(true)
    }
  })

  it('converts weights to kg with the default increment', () => {
    const bench = seedExercises('kg', gearIds).find((e) => e.name === 'Bench Press')
    expect(bench?.default_weight).toBe(42.5)
  })

  it('keeps pounds as entered in lb', () => {
    const bench = seedExercises('lb', gearIds).find((e) => e.name === 'Bench Press')
    expect(bench?.default_weight).toBe(95)
  })

  it('maps gear names to ids', () => {
    const squat = seedExercises('lb', gearIds).find((e) => e.name === 'Back Squat')
    expect(squat?.required_gear_ids).toEqual([gearIds.get('Barbell'), gearIds.get('Squat rack')])
  })

  it('gives bodyweight exercises no gear', () => {
    const pushup = seedExercises('lb', gearIds).find((e) => e.name === 'Push-up')
    expect(pushup?.required_gear_ids).toEqual([])
  })

  it('sets notes, video_url and active on every exercise', () => {
    for (const exercise of seedExercises('lb', gearIds)) {
      expect(exercise).toMatchObject({ notes: '', video_url: null, active: true })
    }
  })

  it('throws naming the gear when a gear id is missing', () => {
    const partial = new Map([...gearIds].filter(([name]) => name !== 'Barbell'))
    expect(() => seedExercises('lb', partial)).toThrow('Barbell')
  })
})
