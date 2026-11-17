import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import {
  NotFoundError,
  convertAmount,
  convertLoad,
  exerciseInputSchema,
  exerciseUnit,
  newId,
  ruleInputSchema,
  stepFor,
} from '@workout/shared'
import type { Exercise, ExerciseInput, RuleInput, Units } from '@workout/shared'
import { exercise, plan, planDay, planItem, profile, progressionRule, setLog } from '../db/schema.js'
import type { Db } from '../db/types.js'
import { distinctNumbers, mapping, remap } from './convert.js'
import { softDeleteItemsWhere, type Tx } from './items.js'
import { assertUuid, byName, dec, isUuid, now, num, readRule, toExercise, toProfile } from './mappers.js'

export async function listExercises(db: Db, userId: string): Promise<Exercise[]> {
  const rows = await db
    .select()
    .from(exercise)
    .where(and(eq(exercise.userId, userId), isNull(exercise.deletedAt)))
  return rows.map(toExercise).sort(byName)
}

export async function saveExercise(db: Db, userId: string, input: ExerciseInput): Promise<Exercise> {
  const parsed = exerciseInputSchema.parse(input)
  const id = assertUuid(parsed.id ?? newId(), 'exercise id')
  parsed.required_gear_ids.forEach((g) => assertUuid(g, 'gear id'))
  const ts = now()
  const fields = {
    name: parsed.name,
    notes: parsed.notes,
    videoUrl: parsed.video_url,
    requiredGearIds: parsed.required_gear_ids,
    active: parsed.active,
    defaultSets: parsed.default_sets,
    defaultReps: parsed.default_reps,
    defaultWeight: dec(parsed.default_weight),
  }
  // supports_angle: omitted keeps the stored value (false on create).
  const flag = parsed.supports_angle === undefined ? {} : { supportsAngle: parsed.supports_angle }
  // unit: omitted keeps the stored value, null follows the app unit.
  const unitFlag = parsed.unit === undefined ? {} : { unit: parsed.unit }
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(exercise)
      .where(and(eq(exercise.userId, userId), eq(exercise.id, id)))
      .for('update')
    let [row] = await tx
      .insert(exercise)
      .values({
        id,
        userId,
        ...fields,
        supportsAngle: parsed.supports_angle ?? false,
        unit: parsed.unit ?? null,
        createdAt: ts,
        updatedAt: ts,
      })
      .onConflictDoUpdate({ target: [exercise.userId, exercise.id], set: { ...fields, ...flag, ...unitFlag, updatedAt: ts } })
      .returning()
    if (before) {
      // Keeping an exercise in the other unit converts every weight that belongs to it, once.
      const [profRow] = await tx.select().from(profile).where(eq(profile.userId, userId))
      if (profRow) {
        const prof = toProfile(profRow)
        const was = exerciseUnit(toExercise(before), prof.units)
        const to = exerciseUnit(toExercise(row!), prof.units)
        if (was !== to) {
          await convertExerciseUnit(tx, userId, id, was, to, prof, ts)
          ;[row] = await tx
            .select()
            .from(exercise)
            .where(and(eq(exercise.userId, userId), eq(exercise.id, id)))
        }
      }
    }
    if (!row!.supportsAngle) {
      // Turning angle support off clears the angle of the exercise's live items.
      await tx
        .update(planItem)
        .set({ angle: null, updatedAt: ts })
        .where(and(eq(planItem.userId, userId), eq(planItem.exerciseId, id), isNull(planItem.deletedAt), isNotNull(planItem.angle)))
    }
    return toExercise(row!)
  })
}

/** Moves one exercise's weights (default, plan items, logged sets, rules) from one unit to the other. */
async function convertExerciseUnit(
  tx: Tx,
  userId: string,
  exerciseId: string,
  from: Units,
  to: Units,
  prof: { units: Units; weight_increment: number },
  ts: Date,
): Promise<void> {
  const fromStep = stepFor(from, prof)
  const toStep = stepFor(to, prof)
  const load = (w: number) => convertLoad(w, from, to)
  const amount = (a: number) => convertAmount(a, from, to, fromStep, toStep)

  const [ex] = await tx
    .select({ weight: exercise.defaultWeight, rule: exercise.defaultRule })
    .from(exercise)
    .where(and(eq(exercise.userId, userId), eq(exercise.id, exerciseId)))
  if (ex) {
    const rule = ex.rule === null ? null : readRule(ex.rule)
    await tx
      .update(exercise)
      .set({
        defaultWeight: dec(load(num(ex.weight))),
        ...(rule && rule.success_action === 'add_weight' ? { defaultRule: { ...rule, success_amount: amount(rule.success_amount) } } : {}),
        updatedAt: ts,
      })
      .where(and(eq(exercise.userId, userId), eq(exercise.id, exerciseId)))
  }

  const items = await tx
    .select({ id: planItem.id, w: planItem.weight, t: planItem.targetWeight })
    .from(planItem)
    .where(and(eq(planItem.userId, userId), eq(planItem.exerciseId, exerciseId)))
  for (const i of items) {
    await tx
      .update(planItem)
      .set({
        weight: i.w === null ? null : dec(load(num(i.w))),
        targetWeight: i.t === null ? null : dec(load(num(i.t))),
        updatedAt: ts,
      })
      .where(and(eq(planItem.userId, userId), eq(planItem.id, i.id)))
  }
  if (items.length > 0) {
    const addWeight = and(
      eq(progressionRule.userId, userId),
      eq(progressionRule.successAction, 'add_weight'),
      inArray(progressionRule.planItemId, items.map((i) => i.id)),
    )
    const rules = await tx.select({ v: progressionRule.successAmount }).from(progressionRule).where(addWeight)
    const ruleMap = mapping(distinctNumbers(rules.map((r) => r.v)), amount)
    if (ruleMap.size > 0) {
      await tx
        .update(progressionRule)
        .set({ successAmount: remap(progressionRule.successAmount, ruleMap), updatedAt: ts })
        .where(addWeight)
    }
  }

  // History can be long: rewrite it on the distinct weights present rather than row by row.
  const logScope = and(eq(setLog.userId, userId), eq(setLog.exerciseId, exerciseId))
  const logs = await tx.select({ w: setLog.weight, t: setLog.targetWeight }).from(setLog).where(logScope)
  const logMap = mapping(distinctNumbers(logs.flatMap((r) => [r.w, r.t])), load)
  if (logMap.size > 0) {
    await tx
      .update(setLog)
      .set({ weight: remap(setLog.weight, logMap), targetWeight: remap(setLog.targetWeight, logMap), updatedAt: ts })
      .where(logScope)
  }
}

export async function setExerciseRule(db: Db, userId: string, id: string, rule: RuleInput | null): Promise<void> {
  const parsed = rule === null ? null : ruleInputSchema.parse(rule)
  if (!isUuid(id)) throw new NotFoundError('Exercise')
  const updated = await db
    .update(exercise)
    .set({ defaultRule: parsed, updatedAt: now() })
    .where(and(eq(exercise.userId, userId), eq(exercise.id, id), isNull(exercise.deletedAt)))
    .returning({ id: exercise.id })
  if (updated.length === 0) throw new NotFoundError('Exercise')
}

export async function deleteExercise(db: Db, userId: string, id: string): Promise<void> {
  if (!isUuid(id)) return
  await db.transaction(async (tx) => {
    const ts = now()
    const [deleted] = await tx
      .update(exercise)
      .set({ deletedAt: ts, updatedAt: ts })
      .where(and(eq(exercise.userId, userId), eq(exercise.id, id), isNull(exercise.deletedAt)))
      .returning({ id: exercise.id })
    if (!deleted) return
    await softDeleteItemsWhere(tx, userId, eq(planItem.exerciseId, id), ts)
  })
}

export async function exerciseUsage(
  db: Db,
  userId: string,
  id: string,
): Promise<{ planItemCount: number; plans: string[] }> {
  if (!isUuid(id)) return { planItemCount: 0, plans: [] }
  const rows = await db
    .select({ planName: plan.name })
    .from(planItem)
    .innerJoin(planDay, and(eq(planDay.userId, planItem.userId), eq(planDay.id, planItem.planDayId)))
    .innerJoin(plan, and(eq(plan.userId, planDay.userId), eq(plan.id, planDay.planId)))
    .where(
      and(
        eq(planItem.userId, userId),
        eq(planItem.exerciseId, id),
        isNull(planItem.deletedAt),
        isNull(planDay.deletedAt),
        isNull(plan.deletedAt),
      ),
    )
  const names = [...new Set(rows.map((r) => r.planName))].sort((a, b) => a.localeCompare(b))
  return { planItemCount: rows.length, plans: names }
}
