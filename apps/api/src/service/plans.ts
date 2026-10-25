import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import {
  ConflictError,
  LIMITS,
  NotFoundError,
  ValidationError,
  angleSchema,
  dayColorSchema,
  effectiveValues,
  newId,
  planItemSchema,
  resolveRule,
  ruleFieldsOf,
  ruleInputSchema,
} from '@workout/shared'
import type { Angle, DayColor, Exercise, PlanItem, Plan, PlanDay, PlanTree, Profile, RuleInput, RuleSource } from '@workout/shared'
import { exercise, itemState, plan, planDay, planItem, profile, progressionRule } from '../db/schema.js'
import type { Db } from '../db/types.js'
import { dissolveLonelyGroups, softDeleteItemsWhere, type Tx } from './items.js'
import { assertUuid, dec, isUuid, now, toExercise, toPlan, toPlanDay, toPlanItem, toProfile, toRule } from './mappers.js'

/** Effective rule of an item (spec §6 layering); `row` is its stored override, if any. */
export function ruleOf(
  item: PlanItem,
  ex: Exercise,
  prof: Profile,
  row: typeof progressionRule.$inferSelect | null | undefined,
): { rule: RuleInput | null; source: RuleSource } {
  return resolveRule({
    itemRule: row ? ruleFieldsOf(toRule(row)) : null,
    inherit: item.inherit_rule,
    exerciseRule: ex.default_rule,
    profileRule: prof.default_rule,
    increment: prof.weight_increment,
  })
}

export async function profileOf(tx: Tx | Db, userId: string): Promise<Profile> {
  const [row] = await tx.select().from(profile).where(eq(profile.userId, userId))
  if (!row) throw new NotFoundError('Profile')
  return toProfile(row)
}

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
    const prof = await profileOf(tx, userId)
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
          const { rule, source } = ruleOf(item, ex, prof, r.rule)
          return { ...item, exercise: ex, rule, ruleSource: source, effective: effectiveValues(item, ex) }
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
  await softDeleteItemsWhere(tx, userId, inArray(planItem.planDayId, dayIds), ts)
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
  input: { id?: string; plan_id: string; name: string; color?: DayColor | null },
): Promise<PlanDay> {
  const id = assertUuid(input.id ?? newId(), 'plan day id')
  if (input.name.length < 1) throw new Error('Day name is required')
  const color = input.color === undefined ? undefined : dayColorSchema.nullable().parse(input.color)
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
        color: color ?? null,
        createdAt: ts,
        updatedAt: ts,
      })
      // Name and colour are editable (an omitted colour is kept); position and plan are kept (use move to reorder).
      .onConflictDoUpdate({
        target: [planDay.userId, planDay.id],
        set: { name: input.name, ...(color === undefined ? {} : { color }), updatedAt: ts },
      })
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
        // No rule row: the item inherits its rule (spec §6) until setRule overrides it.
        inheritRule: true,
        createdAt: ts,
        updatedAt: ts,
      })
      .returning()
    await tx.insert(itemState).values({ userId, planItemId: itemId, failStreak: 0, createdAt: ts, updatedAt: ts })
    return toPlanItem(row!)
  })
}

export async function updatePlanItem(
  db: Db,
  userId: string,
  id: string,
  patch: { sets?: number | null; reps?: number | null; weight?: number | null; angle?: Angle | null; amrap_last?: boolean },
): Promise<PlanItem> {
  if (!isUuid(id)) throw new NotFoundError('Plan item')
  const angle = patch.angle === undefined ? undefined : angleSchema.nullable().parse(patch.angle)
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(planItem)
      .where(and(eq(planItem.userId, userId), eq(planItem.id, id), isNull(planItem.deletedAt)))
      .for('update')
    if (!existing) throw new NotFoundError('Plan item')
    if (angle !== undefined && angle !== null) {
      const [ex] = await tx
        .select({ supports: exercise.supportsAngle })
        .from(exercise)
        .where(and(eq(exercise.userId, userId), eq(exercise.id, existing.exerciseId)))
      if (!ex?.supports) throw new ValidationError('angle', 'This exercise does not support an angle')
    }
    const ts = now()
    const next = toPlanItem(existing)
    if (angle !== undefined) next.angle = angle
    if (patch.amrap_last !== undefined) next.amrap_last = patch.amrap_last
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
        angle: valid.angle,
        amrapLast: valid.amrap_last,
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
  await db.transaction((tx) => softDeleteItemsWhere(tx, userId, eq(planItem.id, id), now()))
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
      // An explicit "no progression" override.
      await tx
        .delete(progressionRule)
        .where(and(eq(progressionRule.userId, userId), eq(progressionRule.planItemId, planItemId)))
      await tx
        .update(planItem)
        .set({ inheritRule: false, updatedAt: now() })
        .where(and(eq(planItem.userId, userId), eq(planItem.id, planItemId), eq(planItem.inheritRule, true)))
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

/** Drops the item's override: back to the inherited rule. */
export async function clearRule(db: Db, userId: string, planItemId: string): Promise<void> {
  if (!isUuid(planItemId)) throw new NotFoundError('Plan item')
  await db.transaction(async (tx) => {
    const [item] = await tx
      .update(planItem)
      .set({ inheritRule: true, updatedAt: now() })
      .where(and(eq(planItem.userId, userId), eq(planItem.id, planItemId), isNull(planItem.deletedAt)))
      .returning({ id: planItem.id })
    if (!item) throw new NotFoundError('Plan item')
    await tx
      .delete(progressionRule)
      .where(and(eq(progressionRule.userId, userId), eq(progressionRule.planItemId, planItemId)))
  })
}

export async function setSuperset(
  db: Db,
  userId: string,
  planDayId: string,
  groupId: string,
  itemIds: string[] | null,
): Promise<void> {
  if (!isUuid(planDayId)) throw new NotFoundError('Plan day')
  if (!isUuid(groupId)) throw new ValidationError('groupId', 'Group id must be a UUID')
  if (itemIds !== null) {
    if (itemIds.length < LIMITS.supersetMin || itemIds.length > LIMITS.supersetMax) {
      throw new ValidationError('item_ids', `A superset has ${LIMITS.supersetMin} to ${LIMITS.supersetMax} items`)
    }
    if (new Set(itemIds).size !== itemIds.length) throw new ValidationError('item_ids', 'Duplicate item')
    if (!itemIds.every(isUuid)) throw new NotFoundError('Plan item')
  }
  await db.transaction(async (tx) => {
    // Lock the day so concurrent regroupings in it serialize.
    const [day] = await tx
      .select({ id: planDay.id })
      .from(planDay)
      .innerJoin(plan, and(eq(plan.userId, planDay.userId), eq(plan.id, planDay.planId)))
      .where(and(eq(planDay.userId, userId), eq(planDay.id, planDayId), isNull(planDay.deletedAt), isNull(plan.deletedAt)))
      .for('update', { of: planDay })
    if (!day) throw new NotFoundError('Plan day')
    const ts = now()
    const live = and(eq(planItem.userId, userId), isNull(planItem.deletedAt))
    const inGroup = await tx
      .select({ id: planItem.id, day: planItem.planDayId })
      .from(planItem)
      .where(and(live, eq(planItem.supersetGroup, groupId)))
    if (inGroup.some((i) => i.day !== planDayId)) throw new ConflictError('Superset group is in use on another day')
    if (itemIds === null) {
      await tx.update(planItem).set({ supersetGroup: null, updatedAt: ts }).where(and(live, eq(planItem.supersetGroup, groupId)))
      return
    }
    const members = await tx
      .select({ id: planItem.id, day: planItem.planDayId, group: planItem.supersetGroup })
      .from(planItem)
      .where(and(live, inArray(planItem.id, itemIds)))
    if (members.length !== itemIds.length) throw new NotFoundError('Plan item')
    if (members.some((m) => m.day !== planDayId)) throw new ValidationError('item_ids', 'Superset items must be in the same day')
    const leaving = inGroup.filter((i) => !itemIds.includes(i.id)).map((i) => i.id)
    if (leaving.length > 0) {
      await tx.update(planItem).set({ supersetGroup: null, updatedAt: ts }).where(and(live, inArray(planItem.id, leaving)))
    }
    await tx.update(planItem).set({ supersetGroup: groupId, updatedAt: ts }).where(and(live, inArray(planItem.id, itemIds)))
    const left = members.map((m) => m.group).filter((g): g is string => g !== null && g !== groupId)
    await dissolveLonelyGroups(tx, userId, left, ts)
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
