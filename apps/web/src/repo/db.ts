import Dexie, { type EntityTable } from 'dexie'
import type {
  Exercise,
  Gear,
  ItemState,
  Plan,
  PlanDay,
  PlanItem,
  Profile,
  ProgressionRule,
  SetLog,
  WorkoutSession,
} from '@workout/shared'

export class AppDb extends Dexie {
  profile!: EntityTable<Profile, 'user_id'>
  gear!: EntityTable<Gear, 'id'>
  exercises!: EntityTable<Exercise, 'id'>
  plans!: EntityTable<Plan, 'id'>
  planDays!: EntityTable<PlanDay, 'id'>
  planItems!: EntityTable<PlanItem, 'id'>
  rules!: EntityTable<ProgressionRule, 'plan_item_id'>
  itemStates!: EntityTable<ItemState, 'plan_item_id'>
  sessions!: EntityTable<WorkoutSession, 'id'>
  setLogs!: EntityTable<SetLog, 'id'>

  constructor(name: string) {
    super(name)
    this.version(1).stores({
      profile: 'user_id',
      gear: 'id',
      exercises: 'id',
      plans: 'id',
      planDays: 'id, plan_id',
      planItems: 'id, plan_day_id, exercise_id',
      rules: 'plan_item_id',
      itemStates: 'plan_item_id',
      sessions: 'id',
      setLogs: 'id, session_id',
    })
  }
}
