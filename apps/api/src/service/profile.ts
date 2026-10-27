import { and, eq, sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import {
  DEFAULT_INCREMENT,
  LIMITS,
  ProfileNotFoundError,
  SEED_GEAR,
  ValidationError,
  displayNameSchema,
  convertWeight,
  newId,
  roundToIncrement,
  ruleInputSchema,
  seedExercises,
} from '@workout/shared'
import type { Profile, RuleInput, Units } from '@workout/shared'
import { exercise, gear, planItem, profile, progressionRule, setLog } from '../db/schema.js'
import type { Db } from '../db/types.js'
import { dec, now, num, readRule, toProfile } from './mappers.js'

export async function init(db: Db, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const ts = now()
    // Concurrent init() calls queue on the primary key; only the one that inserts seeds.
    const inserted = await tx
      .insert(profile)
      .values({
        userId,
        plan: 'free',
        units: 'lb',
        weightIncrement: dec(DEFAULT_INCREMENT.lb),
        createdAt: ts,
        updatedAt: ts,
      })
      .onConflictDoNothing()
      .returning({ userId: profile.userId })
    if (inserted.length === 0) return

    const gearRows = SEED_GEAR.map((name) => ({ id: newId(), userId, name, owned: true, createdAt: ts, updatedAt: ts }))
    await tx.insert(gear).values(gearRows)
    const idsByName = new Map(gearRows.map((g) => [g.name, g.id]))
    await tx.insert(exercise).values(
      seedExercises('lb', idsByName).map((e) => ({
        id: newId(),
        userId,
        name: e.name,
        notes: e.notes,
        videoUrl: e.video_url,
        requiredGearIds: e.required_gear_ids,
        active: e.active,
        defaultSets: e.default_sets,
        defaultReps: e.default_reps,
        defaultWeight: dec(e.default_weight),
        createdAt: ts,
        updatedAt: ts,
      })),
    )
  })
}

export async function getProfile(db: Db, userId: string): Promise<Profile> {
  const [row] = await db.select().from(profile).where(eq(profile.userId, userId))
  if (!row) throw new ProfileNotFoundError()
  return toProfile(row)
}

// CASE col WHEN old THEN new ... ELSE col END over the distinct values present.
function remap(column: AnyPgColumn, mapping: Map<number, number>): SQL {
  const whens = [...mapping].map(([from, to]) => sql`when ${dec(from)}::numeric then ${dec(to)}::numeric`)
  return sql`case ${column} ${sql.join(whens, sql` `)} else ${column} end`
}

const distinctNumbers = (values: (string | null)[]): number[] => [
  ...new Set(values.filter((v): v is string => v !== null).map(num)),
]

function mapping(values: number[], convert: (w: number) => number): Map<number, number> {
  return new Map(values.map((v) => [v, convert(v)]))
}

type Patch = { units?: Units; weight_increment?: number; default_rule?: RuleInput; display_name?: string }

// Converts every stored weight (live and soft-deleted rows alike, as LocalRepo does) in the
// caller's transaction. Rows are matched on distinct values, so cost is bounded by the number of
// distinct weights, not rows.
async function convertUnits(tx: Parameters<Parameters<Db['transaction']>[0]>[0], userId: string, current: Profile, to: Units, ts: Date) {
  const from = current.units
  const step = DEFAULT_INCREMENT[to]
  const conv = (w: number) => convertWeight(w, from, to)
  const convAmount = (amount: number) =>
    Math.min(LIMITS.weight, amount === current.weight_increment ? step : Math.max(step, roundToIncrement(conv(amount), step)))

  const ex = await tx.select({ v: exercise.defaultWeight }).from(exercise).where(eq(exercise.userId, userId))
  const exMap = mapping(distinctNumbers(ex.map((r) => r.v)), conv)
  if (exMap.size > 0) {
    await tx
      .update(exercise)
      .set({ defaultWeight: remap(exercise.defaultWeight, exMap), updatedAt: ts })
      .where(eq(exercise.userId, userId))
  }

  const items = await tx
    .select({ w: planItem.weight, t: planItem.targetWeight })
    .from(planItem)
    .where(eq(planItem.userId, userId))
  const itemMap = mapping(distinctNumbers(items.flatMap((r) => [r.w, r.t])), conv)
  if (itemMap.size > 0) {
    await tx
      .update(planItem)
      .set({
        weight: remap(planItem.weight, itemMap),
        targetWeight: remap(planItem.targetWeight, itemMap),
        updatedAt: ts,
      })
      .where(eq(planItem.userId, userId))
  }

  const logs = await tx
    .select({ w: setLog.weight, t: setLog.targetWeight })
    .from(setLog)
    .where(eq(setLog.userId, userId))
  const logMap = mapping(distinctNumbers(logs.flatMap((r) => [r.w, r.t])), conv)
  if (logMap.size > 0) {
    await tx
      .update(setLog)
      .set({ weight: remap(setLog.weight, logMap), targetWeight: remap(setLog.targetWeight, logMap), updatedAt: ts })
      .where(eq(setLog.userId, userId))
  }

  const addWeight = and(eq(progressionRule.userId, userId), eq(progressionRule.successAction, 'add_weight'))
  const rules = await tx.select({ v: progressionRule.successAmount }).from(progressionRule).where(addWeight)
  const ruleMap = mapping(distinctNumbers(rules.map((r) => r.v)), convAmount)
  if (ruleMap.size > 0) {
    await tx
      .update(progressionRule)
      .set({ successAmount: remap(progressionRule.successAmount, ruleMap), updatedAt: ts })
      .where(addWeight)
  }

  // Exercise default rules (jsonb): bounded by the user's library size, so one update per changed row.
  const exRules = await tx
    .select({ id: exercise.id, rule: exercise.defaultRule })
    .from(exercise)
    .where(and(eq(exercise.userId, userId), sql`${exercise.defaultRule}->>'success_action' = 'add_weight'`))
  for (const row of exRules) {
    const r = readRule(row.rule)
    await tx
      .update(exercise)
      .set({ defaultRule: { ...r, success_amount: convAmount(r.success_amount) }, updatedAt: ts })
      .where(and(eq(exercise.userId, userId), eq(exercise.id, row.id)))
  }

  const rule = current.default_rule
  const defaultRule = rule?.success_action === 'add_weight' ? { ...rule, success_amount: convAmount(rule.success_amount) } : rule
  return { step, defaultRule }
}

export async function updateProfile(db: Db, userId: string, patch: Patch): Promise<Profile> {
  if (patch.weight_increment !== undefined && !(patch.weight_increment > 0)) {
    throw new Error('weight_increment must be greater than 0')
  }
  const defaultRule = patch.default_rule === undefined ? undefined : ruleInputSchema.parse(patch.default_rule)
  let displayName: string | undefined
  if (patch.display_name !== undefined) {
    const r = displayNameSchema.safeParse(patch.display_name)
    if (!r.success) throw new ValidationError('display_name', r.error.issues[0]?.message ?? 'Invalid public name')
    displayName = r.data
  }
  return db.transaction(async (tx) => {
    // Lock the profile row so concurrent unit switches serialize instead of converting twice.
    const [row] = await tx.select().from(profile).where(eq(profile.userId, userId)).for('update')
    if (!row) throw new ProfileNotFoundError()
    const current = toProfile(row)
    const ts = now()
    let units: Units = current.units
    let step = current.weight_increment
    let rule: RuleInput | undefined = current.default_rule
    if (patch.units !== undefined && patch.units !== current.units) {
      const converted = await convertUnits(tx, userId, current, patch.units, ts)
      units = patch.units
      step = converted.step
      rule = converted.defaultRule
    }
    if (patch.weight_increment !== undefined) step = patch.weight_increment
    if (defaultRule !== undefined) rule = defaultRule
    const [updated] = await tx
      .update(profile)
      .set({ units, weightIncrement: dec(step), defaultRule: rule ?? null, ...(displayName === undefined ? {} : { displayName }), updatedAt: ts })
      .where(eq(profile.userId, userId))
      .returning()
    return toProfile(updated!)
  })
}
