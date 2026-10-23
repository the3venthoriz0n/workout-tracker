import type {
  Effective,
  Exercise,
  ExerciseInput,
  Gear,
  ItemState,
  Outcome,
  Plan,
  PlanDay,
  PlanItem,
  Profile,
  ProgressionRule,
  RuleInput,
  SetLog,
  Units,
  WorkoutSession,
} from '@workout/shared'

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
export class SessionInProgressError extends Error {}

export interface Repo {
  init(): Promise<void> // idempotent: guest profile + seeds on first run
  getProfile(): Promise<Profile>
  updateProfile(patch: { units?: Units; weight_increment?: number }): Promise<Profile>
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
  addPlanItem(planDayId: string, exerciseId: string): Promise<PlanItem> // appends; creates defaultRule(increment)
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
    patch: { done?: boolean; actual_reps?: number; weight?: number; note?: string },
  ): Promise<SetLog>
  updateSessionNote(id: string, note: string): Promise<void>
  finishSession(id: string): Promise<FinishSummary>
  discardSession(id: string): Promise<void> // hard-deletes the session and its set logs
  listSessions(): Promise<WorkoutSession[]> // completed only, newest first
  getSession(id: string): Promise<SessionDetail | undefined>
  exportAll(): Promise<ExportData>
}
