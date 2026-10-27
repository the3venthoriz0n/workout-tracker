// Domain tables. They mirror the zod schemas in @workout/shared column for column.
//
// - Primary key is (user_id, id) everywhere (profile: user_id), so two accounts can never
//   collide on a client-generated UUID, and a foreign id never resolves to another user's row.
// - Foreign keys are composite (user_id, parent_id), so a child cannot point at another
//   user's parent.
// - workout_session.plan_day_id and set_log.plan_item_id / exercise_id are deliberately NOT
//   foreign keys: history snapshots names and must survive plan and exercise deletes.
// - Weights are numeric(8,2). Drizzle returns numeric as a string ("62.50"); the service
//   layer converts to and from number at the boundary.
// - Soft deletes: deleted_at is nullable; every query must filter it.
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  foreignKey,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import type { PlanSource, RuleInput } from '@workout/shared'
import { user } from './auth.js'
import { sharedPlan } from './community.js'

const ts = (name: string) => timestamp(name, { withTimezone: true })

const owner = () => ({
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
})

const syncColumns = () => ({
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  deletedAt: ts('deleted_at'),
})

export const profile = pgTable(
  'profile',
  {
    ...owner(),
    plan: text('plan').notNull().default('free'),
    units: text('units').notNull().default('lb'),
    weightIncrement: numeric('weight_increment', { precision: 8, scale: 2 }).notNull(),
    defaultRule: jsonb('default_rule').$type<RuleInput>(),
    // Public name for community plans; null until set.
    displayName: text('display_name'),
    ...syncColumns(),
  },
  (t) => [
    primaryKey({ columns: [t.userId] }),
    check('profile_plan_check', sql`${t.plan} in ('free', 'pro')`),
    check('profile_units_check', sql`${t.units} in ('lb', 'kg')`),
    check('profile_increment_check', sql`${t.weightIncrement} > 0`),
  ],
)

export const gear = pgTable(
  'gear',
  {
    id: uuid('id').notNull(),
    ...owner(),
    name: text('name').notNull(),
    owned: boolean('owned').notNull().default(false),
    ...syncColumns(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.id] })],
)

export const exercise = pgTable(
  'exercise',
  {
    id: uuid('id').notNull(),
    ...owner(),
    name: text('name').notNull(),
    notes: text('notes').notNull().default(''),
    videoUrl: text('video_url'),
    requiredGearIds: uuid('required_gear_ids').array().notNull().default(sql`'{}'::uuid[]`),
    active: boolean('active').notNull().default(true),
    defaultSets: integer('default_sets').notNull(),
    defaultReps: integer('default_reps').notNull(),
    defaultWeight: numeric('default_weight', { precision: 8, scale: 2 }).notNull(),
    supportsAngle: boolean('supports_angle').notNull().default(false),
    // Rule shape validated by the shared zod schema on every write; null = inherit the profile's.
    defaultRule: jsonb('default_rule').$type<RuleInput>(),
    ...syncColumns(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.id] })],
)

export const plan = pgTable(
  'plan',
  {
    id: uuid('id').notNull(),
    ...owner(),
    name: text('name').notNull(),
    archived: boolean('archived').notNull().default(false),
    // Copies of community plans: where they came from (validated by the shared zod schema).
    source: jsonb('source').$type<PlanSource>(),
    // This plan's own listing, set by the first publish (server only; never imported).
    sharedPlanId: uuid('shared_plan_id').references(() => sharedPlan.id, { onDelete: 'set null' }),
    ...syncColumns(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.id] })],
)

export const planDay = pgTable(
  'plan_day',
  {
    id: uuid('id').notNull(),
    ...owner(),
    planId: uuid('plan_id').notNull(),
    name: text('name').notNull(),
    position: integer('position').notNull(),
    color: text('color'),
    ...syncColumns(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.id] }),
    check('plan_day_color_check', sql`${t.color} in ('blue', 'red', 'green', 'amber', 'violet', 'teal', 'pink', 'slate')`),
    foreignKey({
      columns: [t.userId, t.planId],
      foreignColumns: [plan.userId, plan.id],
      name: 'plan_day_plan_fk',
    }).onDelete('cascade'),
  ],
)

export const planItem = pgTable(
  'plan_item',
  {
    id: uuid('id').notNull(),
    ...owner(),
    planDayId: uuid('plan_day_id').notNull(),
    exerciseId: uuid('exercise_id').notNull(),
    position: integer('position').notNull(),
    sets: integer('sets'),
    reps: integer('reps'),
    weight: numeric('weight', { precision: 8, scale: 2 }),
    targetReps: integer('target_reps'),
    targetWeight: numeric('target_weight', { precision: 8, scale: 2 }),
    angle: text('angle'),
    amrapLast: boolean('amrap_last').notNull().default(false),
    // Shared by the 2-3 members of a superset in one day; not a foreign key (groups have no table).
    supersetGroup: uuid('superset_group'),
    // false (the default for rows from before layering): no rule row = no progression.
    inheritRule: boolean('inherit_rule').notNull().default(false),
    ...syncColumns(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.id] }),
    check('plan_item_angle_check', sql`${t.angle} in ('flat', 'incline', 'decline')`),
    foreignKey({
      columns: [t.userId, t.planDayId],
      foreignColumns: [planDay.userId, planDay.id],
      name: 'plan_item_plan_day_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.userId, t.exerciseId],
      foreignColumns: [exercise.userId, exercise.id],
      name: 'plan_item_exercise_fk',
    }).onDelete('cascade'),
  ],
)

// At most one rule per item: keyed by (user_id, plan_item_id).
export const progressionRule = pgTable(
  'progression_rule',
  {
    ...owner(),
    planItemId: uuid('plan_item_id').notNull(),
    successAction: text('success_action').notNull(),
    successAmount: numeric('success_amount', { precision: 8, scale: 2 }).notNull(),
    failStreakLimit: integer('fail_streak_limit').notNull(),
    deloadPct: numeric('deload_pct', { precision: 5, scale: 2 }).notNull(),
    repCeiling: integer('rep_ceiling'),
    ...syncColumns(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.planItemId] }),
    foreignKey({
      columns: [t.userId, t.planItemId],
      foreignColumns: [planItem.userId, planItem.id],
      name: 'progression_rule_plan_item_fk',
    }).onDelete('cascade'),
    check('progression_rule_action_check', sql`${t.successAction} in ('add_weight', 'add_reps')`),
  ],
)

export const itemState = pgTable(
  'item_state',
  {
    ...owner(),
    planItemId: uuid('plan_item_id').notNull(),
    failStreak: integer('fail_streak').notNull().default(0),
    ...syncColumns(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.planItemId] }),
    foreignKey({
      columns: [t.userId, t.planItemId],
      foreignColumns: [planItem.userId, planItem.id],
      name: 'item_state_plan_item_fk',
    }).onDelete('cascade'),
  ],
)

export const workoutSession = pgTable(
  'workout_session',
  {
    id: uuid('id').notNull(),
    ...owner(),
    // Snapshot reference, not a foreign key: sessions outlive plan deletes.
    planDayId: uuid('plan_day_id').notNull(),
    planName: text('plan_name').notNull(),
    dayName: text('day_name').notNull(),
    startedAt: ts('started_at').notNull(),
    completedAt: ts('completed_at'),
    note: text('note').notNull().default(''),
    ...syncColumns(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.id] }),
    // At most one active (unfinished, not deleted) session per user.
    uniqueIndex('workout_session_one_active_idx')
      .on(t.userId)
      .where(sql`${t.completedAt} is null and ${t.deletedAt} is null`),
  ],
)

export const setLog = pgTable(
  'set_log',
  {
    id: uuid('id').notNull(),
    ...owner(),
    sessionId: uuid('session_id').notNull(),
    // Snapshot references, not foreign keys (history survives plan/exercise deletes).
    planItemId: uuid('plan_item_id').notNull(),
    exerciseId: uuid('exercise_id').notNull(),
    exerciseName: text('exercise_name').notNull(),
    setNo: integer('set_no').notNull(),
    position: integer('position').notNull(),
    targetReps: integer('target_reps').notNull(),
    targetWeight: numeric('target_weight', { precision: 8, scale: 2 }).notNull(),
    actualReps: integer('actual_reps').notNull(),
    weight: numeric('weight', { precision: 8, scale: 2 }).notNull(),
    done: boolean('done').notNull().default(false),
    note: text('note').notNull().default(''),
    // Snapshots taken at session start; seq null (older rows) falls back to (position, set_no).
    angle: text('angle'),
    amrap: boolean('amrap').notNull().default(false),
    seq: integer('seq'),
    supersetGroup: uuid('superset_group'),
    supersetLabel: text('superset_label'),
    ...syncColumns(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.id] }),
    foreignKey({
      columns: [t.userId, t.sessionId],
      foreignColumns: [workoutSession.userId, workoutSession.id],
      name: 'set_log_session_fk',
    }).onDelete('cascade'),
  ],
)
