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

describe('new fields (day colour, angle, AMRAP, supersets, layered rules)', () => {
  it('exports the day colour palette and validates colours', async () => {
    const { DAY_COLORS, planDaySchema } = await import('../src/index.js')
    expect(DAY_COLORS).toEqual(['blue', 'red', 'green', 'amber', 'violet', 'teal', 'pink', 'slate'])
    const day = { id: uuid, plan_id: uuid, name: 'D', position: 0, created_at: ts, updated_at: ts, deleted_at: null }
    expect(planDaySchema.parse(day).color).toBeNull() // old rows default to null
    expect(planDaySchema.parse({ ...day, color: 'teal' }).color).toBe('teal')
    expect(planDaySchema.safeParse({ ...day, color: 'mauve' }).success).toBe(false)
  })
  it('defaults the new plan item, exercise and set log fields on old rows', async () => {
    const { planItemSchema, exerciseSchema: ex, setLogSchema: logs } = await import('../src/index.js')
    const item = {
      id: uuid, plan_day_id: uuid, exercise_id: uuid, position: 0, sets: null, reps: null, weight: null,
      target_reps: null, target_weight: null, created_at: ts, updated_at: ts, deleted_at: null,
    }
    // inherit_rule false keeps the old meaning: no rule row = no progression
    expect(planItemSchema.parse(item)).toMatchObject({ angle: null, amrap_last: false, superset_group: null, inherit_rule: false })
    expect(planItemSchema.safeParse({ ...item, angle: 'incline' }).success).toBe(true)
    expect(planItemSchema.safeParse({ ...item, angle: 'upside-down' }).success).toBe(false)
    expect(planItemSchema.safeParse({ ...item, superset_group: 'nope' }).success).toBe(false)
    const exercise = { ...validInput, id: uuid, user_id: uuid, created_at: ts, updated_at: ts, deleted_at: null }
    expect(ex.parse(exercise)).toMatchObject({ supports_angle: false, default_rule: null })
    const log = {
      id: uuid, session_id: uuid, plan_item_id: uuid, exercise_id: uuid, exercise_name: 'Squat',
      set_no: 1, position: 0, target_reps: 5, target_weight: 45, actual_reps: 0, weight: 45, done: false, note: '',
      created_at: ts, updated_at: ts, deleted_at: null,
    }
    expect(logs.parse(log)).toMatchObject({ angle: null, amrap: false, seq: null, superset_group: null, superset_label: null })
    expect(logs.safeParse({ ...log, superset_label: 'x'.repeat(9) }).success).toBe(false)
  })
  it('an export written before these fields still parses, with defaults', async () => {
    const { exportDataSchema } = await import('../src/index.js')
    const old = {
      version: 1, exported_at: ts,
      profile: { user_id: uuid, plan: 'free', units: 'lb', weight_increment: 5, created_at: ts, updated_at: ts, deleted_at: null },
      gear: [], exercises: [{ ...validInput, id: uuid, user_id: uuid, created_at: ts, updated_at: ts, deleted_at: null }],
      plans: [], plan_days: [], plan_items: [], progression_rules: [], item_states: [], workout_sessions: [], set_logs: [],
    }
    const parsed = exportDataSchema.parse(old)
    expect(parsed.exercises[0]).toMatchObject({ supports_angle: false, default_rule: null })
  })
})
