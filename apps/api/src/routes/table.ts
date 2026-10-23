// The single source of truth the route and isolation tests are generated from.
// A test enumerates the Hono router and fails when a registered /api/v1 route is missing here,
// so a new route cannot skip the 401 / 404 / cross-user checks.
import {
  exerciseSchema,
  exportDataSchema,
  gearSchema,
  planDaySchema,
  planItemSchema,
  planSchema,
  profileSchema,
  progressionRuleSchema,
  ruleInputSchema,
  setLogSchema,
  workoutSessionSchema,
} from '@workout/shared'
import type { ExportData } from '@workout/shared'
import { z } from 'zod'

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
/** Kinds of owned ids a path param or body field can carry. */
export type Kind = 'gear' | 'exercise' | 'plan' | 'day' | 'item' | 'session' | 'set'

/** Ids of one user's data. The tests build it by calling the API as that user. */
export type Fixture = Record<Kind, string> & {
  /** A finished session (the `session` kind is the active one, unless the fixture has none). */
  completedSession: string
  /** `GET /export` taken right after the fixture was built. */
  export: ExportData
}

export type RouteSpec = {
  method: Method
  /** Hono path pattern relative to the app, e.g. `/api/v1/days/:dayId/items`. */
  path: string
  /** Path params that carry owned ids: param name to the kind of id it takes. */
  params?: Record<string, Kind>
  /** A valid example body, built from a user's ids (also used with someone else's ids). */
  body?: (f: Fixture) => unknown
  /** Status of the happy path. */
  status: number
  /** Response schema for the happy path (omit for 204). */
  response?: z.ZodType
  /**
   * What happens when ANOTHER user's ids are used:
   *  - `not_found`: 404 {"error":"not_found"}, identical to a random unknown id, nothing changes;
   *  - `upsert`: a PUT that creates the caller's own row under that id (composite keys);
   *  - `none`: takes no ids; only the caller's own data is reachable.
   */
  foreign: 'not_found' | 'upsert' | 'none'
  /** The happy path needs an account without a profile (import is first-time only). */
  freshAccount?: boolean
  /** The happy path needs the user to have no active session (starting one). */
  noActiveSession?: boolean
}

const rule = {
  success_action: 'add_weight',
  success_amount: 5,
  fail_streak_limit: 3,
  deload_pct: 10,
  rep_ceiling: null,
} as const

const sessionDetail = workoutSessionSchema.extend({
  exercises: z.array(
    z.object({
      plan_item_id: z.string(),
      exercise_id: z.string(),
      exercise_name: z.string(),
      video_url: z.string().nullable(),
      notes: z.string(),
      sets: z.array(setLogSchema),
    }),
  ),
})
const planTree = planSchema.extend({
  days: z.array(
    planDaySchema.extend({
      items: z.array(
        planItemSchema.extend({
          exercise: exerciseSchema,
          rule: progressionRuleSchema.nullable(),
          effective: z.object({}).loose(),
        }),
      ),
    }),
  ),
})
const pair = z.object({ reps: z.number(), weight: z.number() })

const exerciseBody = (f: Fixture) => ({
  name: 'Incline Press',
  notes: 'Controlled tempo',
  video_url: null,
  required_gear_ids: [f.gear],
  active: true,
  default_sets: 3,
  default_reps: 8,
  default_weight: 60,
})

const V1 = '/api/v1'

export const ROUTES: RouteSpec[] = [
  { method: 'POST', path: `${V1}/me/init`, status: 200, response: profileSchema, foreign: 'none' },
  { method: 'GET', path: `${V1}/me`, status: 200, response: profileSchema, foreign: 'none' },
  {
    method: 'PATCH',
    path: `${V1}/me`,
    body: () => ({ weight_increment: 2.5, default_rule: rule }),
    status: 200,
    response: profileSchema,
    foreign: 'none',
  },

  { method: 'GET', path: `${V1}/gear`, status: 200, response: z.array(gearSchema), foreign: 'none' },
  {
    method: 'PUT',
    path: `${V1}/gear/:id`,
    params: { id: 'gear' },
    body: () => ({ name: 'Dumbbells', owned: false }),
    status: 200,
    response: gearSchema,
    foreign: 'upsert',
  },
  { method: 'DELETE', path: `${V1}/gear/:id`, params: { id: 'gear' }, status: 204, foreign: 'not_found' },

  { method: 'GET', path: `${V1}/exercises`, status: 200, response: z.array(exerciseSchema), foreign: 'none' },
  {
    method: 'PUT',
    path: `${V1}/exercises/:id`,
    params: { id: 'exercise' },
    body: exerciseBody,
    status: 200,
    response: exerciseSchema,
    foreign: 'upsert',
  },
  { method: 'DELETE', path: `${V1}/exercises/:id`, params: { id: 'exercise' }, status: 204, foreign: 'not_found' },
  {
    method: 'GET',
    path: `${V1}/exercises/:id/usage`,
    params: { id: 'exercise' },
    status: 200,
    response: z.object({ planItemCount: z.number(), plans: z.array(z.string()) }),
    foreign: 'not_found',
  },

  { method: 'GET', path: `${V1}/plans`, status: 200, response: z.array(planSchema), foreign: 'none' },
  { method: 'GET', path: `${V1}/plans/:id`, params: { id: 'plan' }, status: 200, response: planTree, foreign: 'not_found' },
  {
    method: 'PUT',
    path: `${V1}/plans/:id`,
    params: { id: 'plan' },
    body: () => ({ name: 'Push Pull Legs' }),
    status: 200,
    response: planSchema,
    foreign: 'upsert',
  },
  { method: 'DELETE', path: `${V1}/plans/:id`, params: { id: 'plan' }, status: 204, foreign: 'not_found' },

  {
    method: 'PUT',
    path: `${V1}/days/:id`,
    params: { id: 'day' },
    body: (f) => ({ plan_id: f.plan, name: 'Day B' }),
    status: 200,
    response: planDaySchema,
    foreign: 'not_found',
  },
  { method: 'DELETE', path: `${V1}/days/:id`, params: { id: 'day' }, status: 204, foreign: 'not_found' },
  {
    method: 'POST',
    path: `${V1}/days/:dayId/items`,
    params: { dayId: 'day' },
    body: (f) => ({ exercise_id: f.exercise }),
    status: 201,
    response: planItemSchema,
    foreign: 'not_found',
  },
  {
    method: 'PATCH',
    path: `${V1}/items/:id`,
    params: { id: 'item' },
    body: () => ({ sets: 4, reps: 6, weight: 100 }),
    status: 200,
    response: planItemSchema,
    foreign: 'not_found',
  },
  { method: 'DELETE', path: `${V1}/items/:id`, params: { id: 'item' }, status: 204, foreign: 'not_found' },
  {
    method: 'PUT',
    path: `${V1}/items/:id/rule`,
    params: { id: 'item' },
    body: () => ({ rule }),
    status: 200,
    response: z.object({ rule: ruleInputSchema.nullable() }),
    foreign: 'not_found',
  },
  {
    method: 'POST',
    path: `${V1}/move`,
    body: (f) => ({ kind: 'item', id: f.item, direction: 1 }),
    status: 204,
    foreign: 'not_found',
  },

  {
    method: 'GET',
    path: `${V1}/progression`,
    status: 200,
    response: z.array(
      z.object({
        plan_id: z.string(),
        plan_name: z.string(),
        day_id: z.string(),
        day_name: z.string(),
        item_id: z.string(),
        exercise_name: z.string(),
        rule: progressionRuleSchema.nullable(),
      }),
    ),
    foreign: 'none',
  },

  { method: 'GET', path: `${V1}/sessions`, status: 200, response: z.array(workoutSessionSchema), foreign: 'none' },
  { method: 'GET', path: `${V1}/sessions/active`, status: 200, response: sessionDetail.nullable(), foreign: 'none' },
  {
    method: 'POST',
    path: `${V1}/sessions`,
    body: (f) => ({ plan_day_id: f.day }),
    status: 201,
    response: sessionDetail,
    foreign: 'not_found',
    noActiveSession: true,
  },
  { method: 'GET', path: `${V1}/sessions/:id`, params: { id: 'session' }, status: 200, response: sessionDetail, foreign: 'not_found' },
  {
    method: 'PATCH',
    path: `${V1}/sessions/:id`,
    params: { id: 'session' },
    body: () => ({ note: 'Felt strong' }),
    status: 200,
    response: sessionDetail,
    foreign: 'not_found',
  },
  { method: 'DELETE', path: `${V1}/sessions/:id`, params: { id: 'session' }, status: 204, foreign: 'not_found' },
  {
    method: 'POST',
    path: `${V1}/sessions/:id/complete`,
    params: { id: 'session' },
    status: 200,
    response: z.array(
      z.object({ exercise_name: z.string(), outcome: z.string(), before: pair, after: pair }),
    ),
    foreign: 'not_found',
  },
  {
    method: 'PATCH',
    path: `${V1}/sets/:id`,
    params: { id: 'set' },
    body: () => ({ done: true, actual_reps: 5, weight: 100, note: 'ok' }),
    status: 200,
    response: setLogSchema,
    foreign: 'not_found',
  },

  { method: 'GET', path: `${V1}/export`, status: 200, response: exportDataSchema, foreign: 'none' },
  { method: 'POST', path: `${V1}/import`, body: (f) => f.export, status: 204, foreign: 'none', freshAccount: true },
]
