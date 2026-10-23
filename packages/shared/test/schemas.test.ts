import { describe, expect, it } from 'vitest'
import {
  exerciseInputSchema,
  exerciseSchema,
  profileSchema,
  ruleInputSchema,
  setLogSchema,
  workoutSessionSchema,
} from '../src/index.js'

const validInput = {
  name: 'Squat',
  notes: '',
  video_url: null,
  required_gear_ids: [],
  active: true,
  default_sets: 3,
  default_reps: 5,
  default_weight: 45,
}
const ts = '2026-01-01T00:00:00.000Z'
const uuid = '11111111-1111-4111-8111-111111111111'

describe('exerciseInputSchema', () => {
  it('rejects non-http video URLs', () => {
    expect(exerciseInputSchema.safeParse({ ...validInput, video_url: 'javascript:alert(1)' }).success).toBe(false)
    expect(exerciseInputSchema.safeParse({ ...validInput, video_url: 'https://example.com/v' }).success).toBe(true)
    expect(exerciseInputSchema.safeParse({ ...validInput, video_url: null }).success).toBe(true)
  })
  it('rejects zero sets and negative weight', () => {
    expect(exerciseInputSchema.safeParse({ ...validInput, default_sets: 0 }).success).toBe(false)
    expect(exerciseInputSchema.safeParse({ ...validInput, default_weight: -5 }).success).toBe(false)
    expect(exerciseInputSchema.safeParse({ ...validInput, default_reps: 0 }).success).toBe(false)
    expect(exerciseInputSchema.safeParse({ ...validInput, default_reps: 2.5 }).success).toBe(false)
  })
  it('allows an optional id and rejects empty names', () => {
    expect(exerciseInputSchema.safeParse({ ...validInput, id: uuid }).success).toBe(true)
    expect(exerciseInputSchema.safeParse({ ...validInput, name: '' }).success).toBe(false)
  })
})

describe('record schemas', () => {
  it('parses an exercise with base columns', () => {
    const row = { ...validInput, id: uuid, user_id: uuid, created_at: ts, updated_at: ts, deleted_at: null }
    expect(exerciseSchema.safeParse(row).success).toBe(true)
    expect(exerciseSchema.safeParse({ ...row, deleted_at: undefined }).success).toBe(false)
  })
  it('validates profile enums', () => {
    const row = { user_id: uuid, plan: 'free', units: 'lb', weight_increment: 5, created_at: ts, updated_at: ts, deleted_at: null }
    expect(profileSchema.safeParse(row).success).toBe(true)
    expect(profileSchema.safeParse({ ...row, plan: 'gold' }).success).toBe(false)
    expect(profileSchema.safeParse({ ...row, units: 'st' }).success).toBe(false)
  })
  it('allows actual_reps 0 but not set_no 0', () => {
    const row = {
      id: uuid, session_id: uuid, plan_item_id: uuid, exercise_id: uuid, exercise_name: 'Squat',
      set_no: 1, position: 0, target_reps: 5, target_weight: 45, actual_reps: 0, weight: 45, done: false, note: '',
      created_at: ts, updated_at: ts, deleted_at: null,
    }
    expect(setLogSchema.safeParse(row).success).toBe(true)
    expect(setLogSchema.safeParse({ ...row, set_no: 0 }).success).toBe(false)
    expect(setLogSchema.safeParse({ ...row, actual_reps: -1 }).success).toBe(false)
    expect(setLogSchema.safeParse({ ...row, position: -1 }).success).toBe(false)
  })
  it('allows null completed_at on sessions', () => {
    const row = {
      id: uuid, user_id: uuid, plan_day_id: uuid, plan_name: 'P', day_name: 'D', started_at: ts,
      completed_at: null, note: '', created_at: ts, updated_at: ts, deleted_at: null,
    }
    expect(workoutSessionSchema.safeParse(row).success).toBe(true)
  })
  it('validates rule input', () => {
    const rule = { success_action: 'add_weight', success_amount: 5, fail_streak_limit: 3, deload_pct: 10, rep_ceiling: null }
    expect(ruleInputSchema.safeParse(rule).success).toBe(true)
    expect(ruleInputSchema.safeParse({ ...rule, success_action: 'nope' }).success).toBe(false)
    expect(ruleInputSchema.safeParse({ ...rule, fail_streak_limit: 0 }).success).toBe(false)
    expect(ruleInputSchema.safeParse({ ...rule, deload_pct: 101 }).success).toBe(false)
  })
})

describe('rule and increment precision', () => {
  const rule = { success_action: 'add_weight', success_amount: 5, fail_streak_limit: 3, deload_pct: 10, rep_ceiling: null } as const
  it('requires amounts of at least 0.01 in 0.01 steps', () => {
    expect(ruleInputSchema.safeParse({ ...rule, success_amount: 0.001 }).success).toBe(false)
    expect(ruleInputSchema.safeParse({ ...rule, success_amount: 1.234 }).success).toBe(false)
    expect(ruleInputSchema.safeParse({ ...rule, success_amount: 0.01 }).success).toBe(true)
    expect(ruleInputSchema.safeParse({ ...rule, success_amount: 2.5 }).success).toBe(true)
  })
  it('add_reps needs a whole amount of at most 1000', () => {
    const reps = { ...rule, success_action: 'add_reps' } as const
    expect(ruleInputSchema.safeParse({ ...reps, success_amount: 1.5 }).success).toBe(false)
    expect(ruleInputSchema.safeParse({ ...reps, success_amount: 1001 }).success).toBe(false)
    expect(ruleInputSchema.safeParse({ ...reps, success_amount: 2 }).success).toBe(true)
  })
})
