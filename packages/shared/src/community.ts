// Community plans (spec §3, §5, §9): the frozen, public snapshot of a shared plan, the listing
// shapes the API returns, and the two pure functions both sides use to share and to copy a plan,
// so a guest (LocalRepo) and the server produce the same copy.
import { z } from 'zod'
import { ValidationError } from './repo.js'
import type { PlanTree } from './repo.js'
import { ruleFieldsOf } from './rules.js'
import {
  LIMITS,
  angleSchema,
  cleanText,
  dayColorSchema,
  exerciseSchema,
  gearSchema,
  idSchema,
  itemStateSchema,
  levelSchema,
  listingStatusSchema,
  planDaySchema,
  planItemSchema,
  planSchema,
  planSourceSchema,
  progressionRuleSchema,
  ruleInputSchema,
  unitsSchema,
} from './schemas.js'
import type { Exercise, Gear, ItemState, Plan, PlanDay, PlanItem, ProgressionRule, RuleInput } from './schemas.js'
import { KG_PER_LB, roundToIncrement, type Units } from './units.js'

export const COMMUNITY = {
  titleMin: 3,
  titleMax: 60,
  descriptionMax: 500,
  maxDays: 14,
  maxItemsPerDay: 40,
  maxGearPerItem: 20,
  /** Publish operations (a new listing or a new version) per account per rolling 24 hours. */
  publishesPerDay: 5,
  /** Published listings per account at a time. */
  liveListings: 20,
  pageSize: 20,
  queryMax: 100,
} as const

const LINK = /(https?:\/\/|www\.)/i
const noLink = (s: string) => !LINK.test(s)
const LINK_MESSAGE = 'Links are not allowed'

/** Title, description and level of a listing (publish request). Text is cleaned before the checks. */
export const listingMetaSchema = z.object({
  title: z
    .string()
    .transform((s) => cleanText(s))
    .pipe(z.string().min(COMMUNITY.titleMin).max(COMMUNITY.titleMax).refine(noLink, LINK_MESSAGE)),
  description: z
    .string()
    .transform((s) => cleanText(s, true))
    .pipe(z.string().max(COMMUNITY.descriptionMax).refine(noLink, LINK_MESSAGE))
    .default(''),
  level: levelSchema.nullable().default(null),
})
export type ListingMeta = z.input<typeof listingMetaSchema>

// Every snapshot string is cleaned and length-bounded.
const snapText = (max: number) =>
  z
    .string()
    .transform((s) => cleanText(s))
    .pipe(z.string().min(1).max(max))

const snapshotItemSchema = z
  .object({
    exercise: snapText(LIMITS.name),
    gear: z.array(snapText(LIMITS.name)).max(COMMUNITY.maxGearPerItem),
    supports_angle: z.boolean(),
    sets: z.number().int().min(1).max(LIMITS.sets),
    reps: z.number().int().min(1).max(LIMITS.reps),
    weight: z.number().min(0).max(LIMITS.weight),
    angle: angleSchema.nullable(),
    amrap_last: z.boolean(),
    /** Superset letter within the day; 2-3 items share one. */
    superset: z.string().regex(/^[A-Z]$/).nullable(),
    /** The item's effective rule when shared; null = no progression. */
    rule: ruleInputSchema.nullable(),
  })
  .refine((i) => i.angle === null || i.supports_angle, { path: ['angle'], message: 'An angle needs an exercise with angles' })

const snapshotDaySchema = z
  .object({
    name: snapText(LIMITS.name),
    color: dayColorSchema.nullable(),
    items: z.array(snapshotItemSchema).min(1).max(COMMUNITY.maxItemsPerDay),
  })
  .superRefine((day, ctx) => {
    const size = new Map<string, number>()
    for (const i of day.items) if (i.superset !== null) size.set(i.superset, (size.get(i.superset) ?? 0) + 1)
    for (const [key, n] of size) {
      if (n < LIMITS.supersetMin || n > LIMITS.supersetMax) {
        ctx.addIssue({ code: 'custom', path: ['items'], message: `Superset ${key} must have ${LIMITS.supersetMin} to ${LIMITS.supersetMax} exercises` })
      }
    }
  })

/**
 * A published plan version: names and numbers only. No ids, notes, video URLs, history or
 * anything personal. Unknown keys are stripped on parse.
 */
export const sharedSnapshotSchema = z.object({
  name: snapText(LIMITS.name),
  units: unitsSchema,
  days: z.array(snapshotDaySchema).min(1).max(COMMUNITY.maxDays),
})
export type SharedSnapshot = z.infer<typeof sharedSnapshotSchema>

const count = z.number().int().min(0)
const version = z.number().int().min(1).max(1_000_000)

/** The owner's view of one of their listings (`GET /api/v1/shared-plans/mine`). */
export const sharedListingSchema = z.object({
  id: idSchema,
  /** The live plan it was published from (null once that plan is deleted). */
  plan_id: idSchema.nullable(),
  title: z.string(),
  description: z.string(),
  level: levelSchema.nullable(),
  status: listingStatusSchema,
  /** Latest version. */
  version,
  upvotes: count,
  downloads: count,
  created_at: z.string(),
  updated_at: z.string(),
})
export type SharedListing = z.infer<typeof sharedListingSchema>

/** A listing in the public area: exactly these fields, nothing else. */
export const publicListingSchema = z.object({
  id: idSchema,
  title: z.string().min(1).max(COMMUNITY.titleMax),
  description: z.string().max(COMMUNITY.descriptionMax),
  level: levelSchema.nullable(),
  author: z.string().min(1).max(30),
  day_count: z.number().int().min(1).max(COMMUNITY.maxDays),
  /** Latest version. */
  version,
  upvotes: count,
  downloads: count,
  /** When the latest version was published. */
  updated_at: z.string(),
})
export type PublicListing = z.infer<typeof publicListingSchema>

export const publicListPageSchema = z.object({
  items: z.array(publicListingSchema).max(COMMUNITY.pageSize),
  next_cursor: z.string().nullable(),
})
export type PublicListPage = z.infer<typeof publicListPageSchema>

/** `GET /api/public/plans/:id` (latest) and `.../versions/:n`: the listing plus one version. */
export const publicPlanDetailSchema = z.object({
  listing: publicListingSchema,
  version,
  snapshot: sharedSnapshotSchema,
})
export type PublicPlanDetail = z.infer<typeof publicPlanDetailSchema>

/** Query of `GET /api/public/plans`. */
export const publicListQuerySchema = z.object({
  q: z.string().max(COMMUNITY.queryMax).optional(),
  days: z.coerce.number().int().min(1).max(COMMUNITY.maxDays).optional(),
  level: levelSchema.optional(),
  gear: z.literal('none').optional(),
  sort: z.enum(['top', 'new', 'used']).default('top'),
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(COMMUNITY.pageSize).default(COMMUNITY.pageSize),
})
export type PublicListQuery = z.input<typeof publicListQuerySchema>

function parseOr<S extends z.ZodType>(schema: S, value: unknown, path: string): z.infer<S> {
  const r = schema.safeParse(value)
  if (r.success) return r.data
  const issue = r.error.issues[0]
  throw new ValidationError(path, issue ? `${[path, ...issue.path.map(String)].join('.')}: ${issue.message}` : 'Invalid')
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/**
 * The snapshot of a plan as it would be published. Empty days are dropped, a superset with one
 * live member is ungrouped; a plan without exercises, or with too many days or exercises, is a
 * ValidationError. Values are the item's effective base values (sets, reps, weight), never
 * the sharer's progressed targets.
 */
export function snapshotFromPlanTree(tree: PlanTree, units: Units, gear: Pick<Gear, 'id' | 'name'>[]): SharedSnapshot {
  const gearName = new Map(gear.map((g) => [g.id, g.name]))
  const days: unknown[] = []
  for (const day of tree.days) {
    const items = day.items.filter((i) => i.deleted_at === null && i.exercise.deleted_at === null)
    if (items.length === 0) continue
    if (items.length > COMMUNITY.maxItemsPerDay) {
      throw new ValidationError('plan', `A shared day can have at most ${COMMUNITY.maxItemsPerDay} exercises`)
    }
    const size = new Map<string, number>()
    for (const i of items) if (i.superset_group !== null) size.set(i.superset_group, (size.get(i.superset_group) ?? 0) + 1)
    const letter = new Map<string, string>()
    for (const i of items) {
      const g = i.superset_group
      if (g !== null && (size.get(g) ?? 0) >= LIMITS.supersetMin && !letter.has(g)) letter.set(g, LETTERS[letter.size]!)
    }
    days.push({
      name: day.name,
      color: day.color,
      items: items.map((i) => ({
        exercise: i.exercise.name,
        gear: [...new Set(i.exercise.required_gear_ids.flatMap((id) => gearName.get(id) ?? []))],
        supports_angle: i.exercise.supports_angle,
        sets: i.effective.sets,
        reps: i.effective.baseReps,
        weight: i.effective.baseWeight,
        angle: i.exercise.supports_angle ? i.angle : null,
        amrap_last: i.amrap_last,
        superset: i.superset_group === null ? null : (letter.get(i.superset_group) ?? null),
        rule: i.rule === null ? null : ruleFieldsOf(i.rule),
      })),
    })
  }
  if (days.length === 0) throw new ValidationError('plan', 'Add at least one exercise before sharing this plan')
  if (days.length > COMMUNITY.maxDays) throw new ValidationError('plan', `A shared plan can have at most ${COMMUNITY.maxDays} days`)
  const parsed = sharedSnapshotSchema.safeParse({ name: tree.name, units, days })
  if (!parsed.success) {
    throw new ValidationError('plan', `This plan cannot be shared: ${parsed.error.issues[0]?.message ?? 'invalid'}`)
  }
  return parsed.data
}

/** What the adopter already has, plus how to stamp new rows. */
export type AdoptContext = {
  userId: string
  units: Units
  /** The adopter's progression step: converted weights round to it. */
  increment: number
  /** The adopter's exercises and gear (deleted rows are ignored). */
  exercises: Exercise[]
  gear: Gear[]
  now: string
  newId: () => string
}

/** New rows only; existing exercises and gear are referenced, never changed. */
export type AdoptedPlan = {
  plan: Plan
  days: PlanDay[]
  items: PlanItem[]
  rules: ProgressionRule[]
  itemStates: ItemState[]
  newGear: Gear[]
  newExercises: Exercise[]
}

/**
 * The rows of an independent copy of a shared plan (pure). Weights and add_weight amounts are
 * converted to the adopter's units and rounded to their step (an amount never below one step);
 * a value over the limit after conversion is a ValidationError, never clamped. Exercises and gear
 * are matched by case-insensitive name and created when missing (new gear is not marked owned).
 * Item values are stored as overrides and each item's rule as an override (null: no progression),
 * so the copy behaves like the original whatever the adopter's defaults are. An angle on an
 * existing exercise without angle support is dropped.
 */
export function planFromSnapshot(snapshot: unknown, source: unknown, ctx: AdoptContext): AdoptedPlan {
  const snap = parseOr(sharedSnapshotSchema, snapshot, 'snapshot')
  const src = parseOr(planSourceSchema, source, 'source')
  const same = snap.units === ctx.units
  const toUnits = (w: number) => (snap.units === 'lb' ? w * KG_PER_LB : w / KG_PER_LB)
  const tooLarge = () => new ValidationError('snapshot', 'A weight in this plan is too large in your units')
  const weight = (w: number): number => {
    if (same) return w
    const raw = toUnits(w)
    const rounded = roundToIncrement(raw, ctx.increment)
    if (raw > LIMITS.weight || rounded > LIMITS.weight) throw tooLarge()
    return rounded
  }
  const rule = (r: RuleInput | null): RuleInput | null => {
    if (r === null || same || r.success_action !== 'add_weight') return r
    const amount = Math.max(ctx.increment, roundToIncrement(toUnits(r.success_amount), ctx.increment))
    if (amount > LIMITS.weight) throw tooLarge()
    return { ...r, success_amount: amount }
  }

  const sync = { created_at: ctx.now, updated_at: ctx.now, deleted_at: null }
  const key = (s: string) => s.trim().toLowerCase()
  const oldestFirst = <T extends { created_at: string; id: string }>(rows: T[]) =>
    [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
  const gearByName = new Map<string, Gear>()
  for (const g of oldestFirst(ctx.gear.filter((g) => g.deleted_at === null))) if (!gearByName.has(key(g.name))) gearByName.set(key(g.name), g)
  const exByName = new Map<string, Exercise>()
  for (const e of oldestFirst(ctx.exercises.filter((e) => e.deleted_at === null))) if (!exByName.has(key(e.name))) exByName.set(key(e.name), e)

  const out: AdoptedPlan = {
    plan: parseOr(planSchema, { id: ctx.newId(), name: snap.name, archived: false, source: src, published: null, user_id: ctx.userId, ...sync }, 'plan'),
    days: [],
    items: [],
    rules: [],
    itemStates: [],
    newGear: [],
    newExercises: [],
  }
  const gearId = (name: string): string => {
    let g = gearByName.get(key(name))
    if (!g) {
      g = parseOr(gearSchema, { id: ctx.newId(), name, owned: false, user_id: ctx.userId, ...sync }, 'gear')
      gearByName.set(key(name), g)
      out.newGear.push(g)
    }
    return g.id
  }
  const allItems = snap.days.flatMap((d) => d.items)
  const exerciseFor = (item: SharedSnapshot['days'][number]['items'][number]): Exercise => {
    const k = key(item.exercise)
    let e = exByName.get(k)
    if (!e) {
      e = parseOr(
        exerciseSchema,
        {
          id: ctx.newId(),
          name: item.exercise,
          notes: '',
          video_url: null,
          required_gear_ids: [...new Set(item.gear.map(gearId))],
          active: true,
          default_sets: item.sets,
          default_reps: item.reps,
          default_weight: weight(item.weight),
          supports_angle: allItems.some((i) => key(i.exercise) === k && i.supports_angle),
          default_rule: null,
          user_id: ctx.userId,
          ...sync,
        },
        'exercise',
      )
      exByName.set(k, e)
      out.newExercises.push(e)
    }
    return e
  }

  for (const [d, day] of snap.days.entries()) {
    const dayRow = parseOr(planDaySchema, { id: ctx.newId(), plan_id: out.plan.id, name: day.name, position: d, color: day.color, ...sync }, 'day')
    out.days.push(dayRow)
    const groups = new Map<string, string>()
    for (const [position, it] of day.items.entries()) {
      const ex = exerciseFor(it)
      let group: string | null = null
      if (it.superset !== null) {
        group = groups.get(it.superset) ?? ctx.newId()
        groups.set(it.superset, group)
      }
      const r = rule(it.rule)
      const row = parseOr(
        planItemSchema,
        {
          id: ctx.newId(),
          plan_day_id: dayRow.id,
          exercise_id: ex.id,
          position,
          sets: it.sets,
          reps: it.reps,
          weight: weight(it.weight),
          target_reps: null,
          target_weight: null,
          angle: it.angle !== null && ex.supports_angle ? it.angle : null,
          amrap_last: it.amrap_last,
          superset_group: group,
          // A rule row is an override; without one, `false` is the explicit "no progression".
          inherit_rule: r !== null,
          ...sync,
        },
        'item',
      )
      out.items.push(row)
      if (r) out.rules.push(parseOr(progressionRuleSchema, { ...r, plan_item_id: row.id, ...sync }, 'rule'))
      out.itemStates.push(parseOr(itemStateSchema, { plan_item_id: row.id, fail_streak: 0, ...sync }, 'item_state'))
    }
  }
  return out
}
