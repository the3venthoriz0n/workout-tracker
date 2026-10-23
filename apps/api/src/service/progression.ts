import { and, asc, eq, isNull } from 'drizzle-orm'
import type { ProgressionRow } from '@workout/shared'
import { exercise, plan, planDay, planItem, progressionRule } from '../db/schema.js'
import type { Db } from '../db/types.js'
import { toRule } from './mappers.js'

export async function listProgression(db: Db, userId: string): Promise<ProgressionRow[]> {
  const rows = await db
    .select({ p: plan, d: planDay, i: planItem, e: exercise, r: progressionRule })
    .from(planItem)
    .innerJoin(planDay, and(eq(planDay.userId, planItem.userId), eq(planDay.id, planItem.planDayId)))
    .innerJoin(plan, and(eq(plan.userId, planDay.userId), eq(plan.id, planDay.planId)))
    .innerJoin(exercise, and(eq(exercise.userId, planItem.userId), eq(exercise.id, planItem.exerciseId)))
    .leftJoin(
      progressionRule,
      and(eq(progressionRule.userId, planItem.userId), eq(progressionRule.planItemId, planItem.id)),
    )
    .where(
      and(
        eq(planItem.userId, userId),
        isNull(planItem.deletedAt),
        isNull(planDay.deletedAt),
        isNull(plan.deletedAt),
      ),
    )
    .orderBy(asc(plan.createdAt), asc(plan.name), asc(plan.id), asc(planDay.position), asc(planDay.id), asc(planItem.position), asc(planItem.id))
  return rows.map((r) => ({
    plan_id: r.p.id,
    plan_name: r.p.name,
    day_id: r.d.id,
    day_name: r.d.name,
    item_id: r.i.id,
    exercise_name: r.e.name,
    rule: r.r ? toRule(r.r) : null,
  }))
}
