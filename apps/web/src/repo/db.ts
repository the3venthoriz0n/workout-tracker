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
    // v2: day colour, angle, AMRAP, supersets, layered rules. Same indexes; existing rows get the
    // new fields with defaults that keep their meaning (inherit_rule false: a missing rule row
    // still means "no progression", an existing rule row stays an override).
    this.version(2)
      .stores({})
      .upgrade(async (tx) => {
        const fill = <T extends object>(row: T, defaults: Record<string, unknown>) => {
          const r = row as Record<string, unknown>
          for (const [k, v] of Object.entries(defaults)) if (r[k] === undefined) r[k] = v
        }
        await tx.table('planDays').toCollection().modify((d) => fill(d, { color: null }))
        await tx.table('exercises').toCollection().modify((e) => fill(e, { supports_angle: false, default_rule: null }))
        await tx
          .table('planItems')
          .toCollection()
          .modify((i) => fill(i, { angle: null, amrap_last: false, superset_group: null, inherit_rule: false }))
        await tx
          .table('setLogs')
          .toCollection()
          .modify((l) => fill(l, { angle: null, amrap: false, seq: null, superset_group: null, superset_label: null }))
      })
  }
}
