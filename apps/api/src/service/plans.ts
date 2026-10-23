import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import {
  ConflictError,
  NotFoundError,
  defaultRule,
  effectiveValues,
  newId,
  planItemSchema,
  ruleInputSchema,
} from '@workout/shared'
import type { Plan, PlanDay, PlanItem, PlanTree, RuleInput } from '@workout/shared'
import { exercise, itemState, plan, planDay, planItem, profile, progressionRule } from '../db/schema.js'
import type { Db } from '../db/types.js'
import { assertUuid, dec, isUuid, now, num, readRule, toExercise, toPlan, toPlanDay, toPlanItem, toRule } from './mappers.js'

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

const nextPosition = (max: number | null): number => (max === null ? 0 : max + 1)

export async function listPlans(db: Db, userId: string): Promise<Plan[]> {
  const rows = await db
    .select()
    .from(plan)
    .where(and(eq(plan.userId, userId), isNull(plan.deletedAt)))
  return rows
    .map(toPlan)
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.name.localeCompare(b.name))
}

export async function getPlan(db: Db, userId: string, id: string): Promise<PlanTree | undefined> {
  if (!isUuid(id)) return undefined
  // One snapshot so the tree is consistent while writers run.
  return db.transaction(async (tx) => {
    const [planRow] = await tx
      .select()
      .from(plan)
      .where(and(eq(plan.userId, userId), eq(plan.id, id), isNull(plan.deletedAt)))
    if (!planRow) return undefined
    const dayRows = await tx
      .select()
      .from(planDay)
      .where(and(eq(planDay.userId, userId), eq(planDay.planId, id), isNull(planDay.deletedAt)))
      .orderBy(asc(planDay.position), asc(planDay.createdAt))
    const dayIds = dayRows.map((d) => d.id)
    const itemRows =
      dayIds.length === 0
        ? []
        : await tx
            .select({ item: planItem, ex: exercise, rule: progressionRule })
            .from(planItem)
            .innerJoin(exercise, and(eq(exercise.userId, planItem.userId), eq(exercise.id, planItem.exerciseId)))
            .leftJoin(
              progressionRule,
              and(eq(progressionRule.userId, planItem.userId), eq(progressionRule.planItemId, planItem.id)),
            )
            .where(
              and(
                eq(planItem.userId, userId),
                inArray(planItem.planDayId, dayIds),
                isNull(planItem.deletedAt),
              ),
            )
            .orderBy(asc(planItem.position), asc(planItem.createdAt))
    const days = dayRows.map((d) => ({
      ...toPlanDay(d),
      items: itemRows
        .filter((r) => r.item.planDayId === d.id)
        .map((r) => {
          const item = toPlanItem(r.item)
          const ex = toExercise(r.ex)
          return { ...item, exercise: ex, rule: r.rule ? toRule(r.rule) : null, effective: effectiveValues(item, ex) }
        }),
    }))
    return { ...toPlan(planRow), days }
  })
}

export async function savePlan(db: Db, userId: string, input: { id?: string; name: string }): Promise<Plan> {
  const id = assertUuid(input.id ?? newId(), 'plan id')
  if (input.name.length < 1) throw new Error('Plan name is required')
  const ts = now()
  const [row] = await db
    .insert(plan)
    .values({ id, userId, name: input.name, archived: false, createdAt: ts, updatedAt: ts })
    .onConflictDoUpdate({ target: [plan.userId, plan.id], set: { name: input.name, updatedAt: ts } })
    .returning()
  return toPlan(row!)
}

async function softDeleteItemsOfDays(tx: Tx, userId: string, dayIds: string[], ts: Date): Promise<void> {
  if (dayIds.length === 0) return
  await tx
    .update(planItem)
    .set({ deletedAt: ts, updatedAt: ts })
    .where(and(eq(planItem.userId, userId), inArray(planItem.planDayId, dayIds), isNull(planItem.deletedAt)))
}

export async function deletePlan(db: Db, userId: string, id: string): Promise<void> {
  if (!isUuid(id)) return
  await db.transaction(async (tx) => {
    const ts = now()
    const [deleted] = await tx
      .update(plan)
      .set({ deletedAt: ts, updatedAt: ts })
      .where(and(eq(plan.userId, userId), eq(plan.id, id), isNull(plan.deletedAt)))
      .returning({ id: plan.id })
    if (!deleted) return
    // Every day of the plan, including any already soft-deleted: their items must not stay live.
    const days = await tx
      .select({ id: planDay.id, deletedAt: planDay.deletedAt })
      .from(planDay)
      .where(and(eq(planDay.userId, userId), eq(planDay.planId, id)))
    await tx
      .update(planDay)
      .set({ deletedAt: ts, updatedAt: ts })
      .where(and(eq(planDay.userId, userId), eq(planDay.planId, id), isNull(planDay.deletedAt)))
    await softDeleteItemsOfDays(tx, userId, days.map((d) => d.id), ts)
  })
}

export async function savePlanDay(
  db: Db,
  userId: string,
  input: { id?: string; plan_id: string; name: string },
): Promise<PlanDay> {
  const id = assertUuid(input.id ?? newId(), 'plan day id')
  if (input.name.length < 1) throw new Error('Day name is required')
  if (!isUuid(input.plan_id)) throw new NotFoundError('Plan')
  return db.transaction(async (tx) => {
    // Lock the parent so concurrent appends serialize and never pick the same position.
    const [parent] = await tx
      .select({ id: plan.id })
      .from(plan)
      .where(and(eq(plan.userId, userId), eq(plan.id, input.plan_id), isNull(plan.deletedAt)))
      .for('update')
    if (!parent) throw new NotFoundError('Plan')
    const ts = now()
    const [max] = await tx
      .select({ max: sql<number | null>`max(${planDay.position})` })
      .from(planDay)
      .where(and(eq(planDay.userId, userId), eq(planDay.planId, input.plan_id), isNull(planDay.deletedAt)))
    const [row] = await tx
      .insert(planDay)
      .values({
        id,
        userId,
        planId: input.plan_id,
        name: input.name,
        position: nextPosition(max?.max ?? null),
        createdAt: ts,
        updatedAt: ts,
      })
      // Only the name is editable; position and plan are kept (use move to reorder).
      .onConflictDoUpdate({ target: [planDay.userId, planDay.id], set: { name: input.name, updatedAt: ts } })
      .returning()
    return toPlanDay(row!)
  })
}

export async function deletePlanDay(db: Db, userId: string, id: string): Promise<void> {
  if (!isUuid(id)) return
  await db.transaction(async (tx) => {
    const ts = now()
    const [deleted] = await tx
      .update(planDay)
      .set({ deletedAt: ts, updatedAt: ts })
      .where(and(eq(planDay.userId, userId), eq(planDay.id, id), isNull(planDay.deletedAt)))
      .returning({ id: planDay.id })
    if (!deleted) return
    await softDeleteItemsOfDays(tx, userId, [id], ts)
  })
}

/** `id` makes the add idempotent: the same id for the same day and exercise returns the existing item. */
export async function addPlanItem(
  db: Db,
  userId: string,
  planDayId: string,
  exerciseId: string,
  id?: string,
): Promise<PlanItem> {
  if (id !== undefined && !isUuid(id)) throw new Error('plan item id must be a UUID')
  if (!isUuid(planDayId)) throw new NotFoundError('Plan day')
  if (!isUuid(exerciseId)) throw new NotFoundError('Exercise')
  return db.transaction(async (tx) => {
    const [day] = await tx
      .select({ id: planDay.id })
      .from(planDay)
      .innerJoin(plan, and(eq(plan.userId, planDay.userId), eq(plan.id, planDay.planId)))
      .where(and(eq(planDay.userId, userId), eq(planDay.id, planDayId), isNull(planDay.deletedAt), isNull(plan.deletedAt)))
      .for('update', { of: planDay })
    if (!day) throw new NotFoundError('Plan day')
    const [ex] = await tx
      .select({ id: exercise.id })
      .from(exercise)
      .where(and(eq(exercise.userId, userId), eq(exercise.id, exerciseId), isNull(exercise.deletedAt)))
    if (!ex) throw new NotFoundError('Exercise')
    const [prof] = await tx.select().from(profile).where(eq(profile.userId, userId))
    if (!prof) throw new NotFoundError('Profile')

    if (id !== undefined) {
      const [dup] = await tx
        .select()
        .from(planItem)
        .where(and(eq(planItem.userId, userId), eq(planItem.id, id)))
      if (dup) {
        if (dup.deletedAt !== null || dup.planDayId !== planDayId || dup.exerciseId !== exerciseId) {
          throw new ConflictError('Plan item id already in use')
        }
        return toPlanItem(dup)
      }
    }
    const [max] = await tx
      .select({ max: sql<number | null>`max(${planItem.position})` })
      .from(planItem)
      .where(and(eq(planItem.userId, userId), eq(planItem.planDayId, planDayId), isNull(planItem.deletedAt)))
    const ts = now()
    const itemId = id ?? newId()
    const [row] = await tx
      .insert(planItem)
      .values({
        id: itemId,
        userId,
        planDayId,
        exerciseId,
        position: nextPosition(max?.max ?? null),
        createdAt: ts,
        updatedAt: ts,
      })
      .returning()
    const startRule: RuleInput = prof.defaultRule
      ? readRule(prof.defaultRule)
      : defaultRule(num(prof.weightIncrement))
    await tx.insert(progressionRule).values({
      userId,
      planItemId: itemId,
      successAction: startRule.success_action,
      successAmount: dec(startRule.success_amount),
      failStreakLimit: startRule.fail_streak_limit,
      deloadPct: dec(startRule.deload_pct),
      repCeiling: startRule.rep_ceiling,
      createdAt: ts,
      updatedAt: ts,
    })
    await tx.insert(itemState).values({ userId, planItemId: itemId, failStreak: 0, createdAt: ts, updatedAt: ts })
    return toPlanItem(row!)
  })
}

export async function updatePlanItem(
  db: Db,
  userId: string,
  id: string,
  patch: { sets?: number | null; reps?: number | null; weight?: number | null },
): Promise<PlanItem> {
  if (!isUuid(id)) throw new NotFoundError('Plan item')
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(planItem)
      .where(and(eq(planItem.userId, userId), eq(planItem.id, id), isNull(planItem.deletedAt)))
      .for('update')
    if (!existing) throw new NotFoundError('Plan item')
    const ts = now()
    const next = toPlanItem(existing)
    if (patch.sets !== undefined) next.sets = patch.sets
    if (patch.reps !== undefined) next.reps = patch.reps
    if (patch.weight !== undefined) next.weight = patch.weight
    const clears = patch.reps !== undefined || patch.weight !== undefined
    if (clears) {
      next.target_reps = null
      next.target_weight = null
    }
    const valid = planItemSchema.parse(next)
    const [row] = await tx
      .update(planItem)
      .set({
        sets: valid.sets,
        reps: valid.reps,
        weight: valid.weight === null ? null : dec(valid.weight),
        targetReps: valid.target_reps,
        targetWeight: valid.target_weight === null ? null : dec(valid.target_weight),
        updatedAt: ts,
      })
      .where(and(eq(planItem.userId, userId), eq(planItem.id, id)))
      .returning()
    if (clears) {
      await tx
        .update(itemState)
        .set({ failStreak: 0, updatedAt: ts })
        .where(and(eq(itemState.userId, userId), eq(itemState.planItemId, id)))
    }
    return toPlanItem(row!)
  })
}

export async function deletePlanItem(db: Db, userId: string, id: string): Promise<void> {
  if (!isUuid(id)) return
  const ts = now()
  await db
    .update(planItem)
    .set({ deletedAt: ts, updatedAt: ts })
    .where(and(eq(planItem.userId, userId), eq(planItem.id, id), isNull(planItem.deletedAt)))
}

export async function setRule(db: Db, userId: string, planItemId: string, rule: RuleInput | null): Promise<void> {
  const parsed = rule === null ? null : ruleInputSchema.parse(rule)
  if (!isUuid(planItemId)) throw new NotFoundError('Plan item')
  await db.transaction(async (tx) => {
    const [item] = await tx
      .select({ id: planItem.id })
      .from(planItem)
      .where(and(eq(planItem.userId, userId), eq(planItem.id, planItemId), isNull(planItem.deletedAt)))
      .for('update')
    if (!item) throw new NotFoundError('Plan item')
    if (parsed === null) {
      await tx
        .delete(progressionRule)
        .where(and(eq(progressionRule.userId, userId), eq(progressionRule.planItemId, planItemId)))
      return
    }
    const ts = now()
    const fields = {
      successAction: parsed.success_action,
      successAmount: dec(parsed.success_amount),
      failStreakLimit: parsed.fail_streak_limit,
      deloadPct: dec(parsed.deload_pct),
      repCeiling: parsed.rep_ceiling,
    }
    await tx
      .insert(progressionRule)
      .values({ userId, planItemId, ...fields, createdAt: ts, updatedAt: ts })
      .onConflictDoUpdate({
        target: [progressionRule.userId, progressionRule.planItemId],
        set: { ...fields, updatedAt: ts, deletedAt: null },
      })
  })
}

export async function move(db: Db, userId: string, kind: 'day' | 'item', id: string, direction: -1 | 1): Promise<void> {
  if (!isUuid(id)) throw new NotFoundError(kind === 'day' ? 'Plan day' : 'Plan item')
  await db.transaction(async (tx) => {
    const ts = now()
    if (kind === 'day') {
      const [row] = await tx
        .select()
        .from(planDay)
        .where(and(eq(planDay.userId, userId), eq(planDay.id, id), isNull(planDay.deletedAt)))
      if (!row) throw new NotFoundError('Plan day')
      // Lock the parent so concurrent moves/appends in this plan serialize.
      await tx.select({ id: plan.id }).from(plan).where(and(eq(plan.userId, userId), eq(plan.id, row.planId))).for('update')
      const siblings = await tx
        .select({ id: planDay.id, position: planDay.position })
        .from(planDay)
        .where(and(eq(planDay.userId, userId), eq(planDay.planId, row.planId), isNull(planDay.deletedAt)))
        .orderBy(asc(planDay.position), asc(planDay.createdAt))
      const i = siblings.findIndex((s) => s.id === id)
      const other = siblings[i + direction]
      if (i < 0 || !other) return
      const me = siblings[i]!
      await tx.update(planDay).set({ position: other.position, updatedAt: ts }).where(and(eq(planDay.userId, userId), eq(planDay.id, me.id)))
      await tx.update(planDay).set({ position: me.position, updatedAt: ts }).where(and(eq(planDay.userId, userId), eq(planDay.id, other.id)))
    } else {
      const [row] = await tx
        .select()
        .from(planItem)
        .where(and(eq(planItem.userId, userId), eq(planItem.id, id), isNull(planItem.deletedAt)))
      if (!row) throw new NotFoundError('Plan item')
      await tx.select({ id: planDay.id }).from(planDay).where(and(eq(planDay.userId, userId), eq(planDay.id, row.planDayId))).for('update')
      const siblings = await tx
        .select({ id: planItem.id, position: planItem.position })
        .from(planItem)
        .where(and(eq(planItem.userId, userId), eq(planItem.planDayId, row.planDayId), isNull(planItem.deletedAt)))
        .orderBy(asc(planItem.position), asc(planItem.createdAt))
      const i = siblings.findIndex((s) => s.id === id)
      const other = siblings[i + direction]
      if (i < 0 || !other) return
      const me = siblings[i]!
      await tx.update(planItem).set({ position: other.position, updatedAt: ts }).where(and(eq(planItem.userId, userId), eq(planItem.id, me.id)))
      await tx.update(planItem).set({ position: me.position, updatedAt: ts }).where(and(eq(planItem.userId, userId), eq(planItem.id, other.id)))
    }
  })
}
