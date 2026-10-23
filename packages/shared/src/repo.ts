import type {
  Exercise,
  ExerciseInput,
  Gear,
  ItemState,
  Plan,
  PlanDay,
  PlanItem,
  Profile,
  ProgressionRule,
  RuleInput,
  SetLog,
  WorkoutSession,
} from './schemas.js'
import type { Effective } from './effective.js'
import type { Outcome } from './progression.js'
import type { Units } from './units.js'

export type PlanTree = Plan & {
  days: (PlanDay & {
    items: (PlanItem & { exercise: Exercise; rule: ProgressionRule | null; effective: Effective })[]
  })[]
}
export type SessionDetail = WorkoutSession & {
  exercises: {
    plan_item_id: string
    exercise_id: string
    exercise_name: string
    video_url: string | null
    notes: string
    sets: SetLog[]
  }[]
}
export type FinishSummary = {
  exercise_name: string
  outcome: Outcome
  before: { reps: number; weight: number }
  after: { reps: number; weight: number }
}[]
export type ExportData = {
  version: 1
  exported_at: string
  profile: Profile
  gear: Gear[]
  exercises: Exercise[]
  plans: Plan[]
  plan_days: PlanDay[]
  plan_items: PlanItem[]
  progression_rules: ProgressionRule[]
  item_states: ItemState[]
  workout_sessions: WorkoutSession[]
  set_logs: SetLog[]
}
export type ProgressionRow = {
  plan_id: string
  plan_name: string
  day_id: string
  day_name: string
  item_id: string
  exercise_name: string
  rule: ProgressionRule | null
}
export class SessionInProgressError extends Error {}
// Thrown by importAll() when the account already has a profile (import is first-time only).
export class AlreadyHasDataError extends Error {
  constructor() {
    super('Account already has data')
    this.name = 'AlreadyHasDataError'
  }
}
// Thrown by importAll() when the file is malformed or references rows that are not in it.
export class ImportInvalidError extends Error {
  constructor(message = 'Invalid import file') {
    super(message)
    this.name = 'ImportInvalidError'
  }
}
// Thrown when an id does not resolve to a live row owned by the caller (missing, deleted or foreign).
export class NotFoundError extends Error {
  constructor(what = 'Resource') {
    super(`${what} not found`)
    this.name = 'NotFoundError'
  }
}
// Thrown by getProfile() when the account has no profile yet (init() has not run).
export class ProfileNotFoundError extends Error {
  constructor() {
    super('Profile missing: init() has not run')
    this.name = 'ProfileNotFoundError'
  }
}

export interface Repo {
  init(): Promise<void> // idempotent: guest profile + seeds on first run
  getProfile(): Promise<Profile>
  updateProfile(patch: {
    units?: Units
    weight_increment?: number
    default_rule?: RuleInput
  }): Promise<Profile>
  listGear(): Promise<Gear[]>
  saveGear(input: { id?: string; name: string; owned: boolean }): Promise<Gear>
  listExercises(): Promise<Exercise[]> // sorted by name
  saveExercise(input: ExerciseInput): Promise<Exercise>
  deleteExercise(id: string): Promise<void> // cascades: soft-deletes its live plan items too
  exerciseUsage(id: string): Promise<{ planItemCount: number; plans: string[] }>
  deleteGear(id: string): Promise<void> // also removes it from exercises' required_gear_ids
  listPlans(): Promise<Plan[]>
  getPlan(id: string): Promise<PlanTree | undefined> // days and items sorted by position
  savePlan(input: { id?: string; name: string }): Promise<Plan>
  deletePlan(id: string): Promise<void> // soft-deletes days and items too
  savePlanDay(input: { id?: string; plan_id: string; name: string }): Promise<PlanDay>
  deletePlanDay(id: string): Promise<void>
  addPlanItem(planDayId: string, exerciseId: string): Promise<PlanItem> // appends; rule = profile.default_rule if set, else defaultRule(progression step)
  updatePlanItem(
    id: string,
    patch: { sets?: number | null; reps?: number | null; weight?: number | null },
  ): Promise<PlanItem>
  deletePlanItem(id: string): Promise<void>
  setRule(planItemId: string, rule: RuleInput | null): Promise<void>
  move(kind: 'day' | 'item', id: string, direction: -1 | 1): Promise<void>
  getActiveSession(): Promise<SessionDetail | undefined>
  startSession(planDayId: string): Promise<SessionDetail> // throws SessionInProgressError
  updateSet(
    id: string,
    patch: { done?: boolean; actual_reps?: number; weight?: number; note?: string; updated_at?: string },
  ): Promise<SetLog>
  updateSessionNote(id: string, note: string): Promise<void>
  finishSession(id: string): Promise<FinishSummary>
  discardSession(id: string): Promise<void> // hard-deletes the session and its set logs
  listSessions(): Promise<WorkoutSession[]> // completed only, newest first
  getSession(id: string): Promise<SessionDetail | undefined>
  exportAll(): Promise<ExportData>
  listProgression(): Promise<ProgressionRow[]> // live plan items with their rules, in plan/day/item order
}
