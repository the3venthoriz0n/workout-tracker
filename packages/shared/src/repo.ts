import type {
  Angle,
  DayColor,
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
  RuleSource,
  SetLog,
  WorkoutSession,
} from './schemas.js'
import type { ExerciseProgression } from './rules.js'
import type { Effective } from './effective.js'
import type { Outcome } from './progression.js'
import type { Units } from './units.js'

/**
 * A plan item as the UI sees it. `rule` is the EFFECTIVE rule (what finishing a session uses):
 * the item's override, else the exercise's, the profile's or the built-in default; `ruleSource` says
 * which. `rule: null` with `ruleSource: 'item'` is an explicit "no progression" override.
 */
export type PlanItemView = PlanItem & {
  exercise: Exercise
  rule: RuleInput | null
  ruleSource: RuleSource
  effective: Effective
}
export type PlanTree = Plan & {
  days: (PlanDay & { items: PlanItemView[] })[]
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
  exercise_id: string
  exercise_name: string
  /** Effective rule, as in PlanItemView. */
  rule: RuleInput | null
  ruleSource: RuleSource
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
// Thrown when the request conflicts with the row's state (e.g. finishing or discarding a completed session).
export class ConflictError extends Error {
  constructor(message = 'Conflict') {
    super(message)
    this.name = 'ConflictError'
  }
}
// Thrown by getProfile() when the account has no profile yet (init() has not run).
export class ProfileNotFoundError extends Error {
  constructor() {
    super('Profile missing: init() has not run')
    this.name = 'ProfileNotFoundError'
  }
}

// Thrown by ApiRepo on 401: there is no valid session (signed out or expired).
export class UnauthenticatedError extends Error {
  constructor() {
    super('Not signed in')
    this.name = 'UnauthenticatedError'
  }
}
// Thrown by ApiRepo when the request never reached the server (network failure).
export class OfflineError extends Error {
  constructor() {
    super('Offline')
    this.name = 'OfflineError'
  }
}
// Thrown by ApiRepo for any other non-2xx response. Carries the status and the server's error code only.
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code?: string,
  ) {
    super(code ? `Request failed (${status}: ${code})` : `Request failed (${status})`)
    this.name = 'ApiError'
  }
}
/**
 * A request that breaks a rule needing stored data (angle on an exercise without angle support,
 * superset size or day). Thrown by LocalRepo and the service; the API answers 400 invalid and
 * ApiRepo maps that back to this class. It is an ApiError(400) so the offline queue treats it as
 * permanent, like any other 4xx.
 */
export class ValidationError extends ApiError {
  constructor(
    readonly path = '',
    message = 'Invalid request',
  ) {
    super(400, 'invalid')
    this.message = message
    this.name = 'ValidationError'
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
  // color: undefined keeps the stored colour (null on create)
  savePlanDay(input: { id?: string; plan_id: string; name: string; color?: DayColor | null }): Promise<PlanDay>
  deletePlanDay(id: string): Promise<void>
  addPlanItem(planDayId: string, exerciseId: string): Promise<PlanItem> // appends; no rule row: inherits (spec §6)
  updatePlanItem(
    id: string,
    // angle needs exercise.supports_angle (else ValidationError); angle/amrap_last never clear targets
    patch: { sets?: number | null; reps?: number | null; weight?: number | null; angle?: Angle | null; amrap_last?: boolean },
  ): Promise<PlanItem>
  deletePlanItem(id: string): Promise<void> // also leaves its superset (a group of one dissolves)
  setRule(planItemId: string, rule: RuleInput | null): Promise<void> // item override; null = "no progression"
  clearRule(planItemId: string): Promise<void> // drop the override: back to the inherited rule
  setExerciseRule(exerciseId: string, rule: RuleInput | null): Promise<void> // exercise.default_rule; null clears
  /**
   * Makes `itemIds` (2-3 live items of `planDayId`) the members of superset `groupId` (a client
   * newId()); members of other groups move, and any group left with one member dissolves. `null`
   * dissolves the group. ValidationError for size/duplicates/another day, NotFoundError for unknown
   * ids, ConflictError when `groupId` is in use on another day.
   */
  setSuperset(planDayId: string, groupId: string, itemIds: string[] | null): Promise<void>
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
  listProgressionByExercise(): Promise<ExerciseProgression[]> // every live exercise once, sorted by name
}
