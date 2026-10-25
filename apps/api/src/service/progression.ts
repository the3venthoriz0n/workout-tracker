import { and, asc, eq, isNull } from 'drizzle-orm'
import { groupProgressionByExercise } from '@workout/shared'
import type { ExerciseProgression, ProgressionRow } from '@workout/shared'
import { exercise, plan, planDay, planItem, progressionRule } from '../db/schema.js'
import type { Db } from '../db/types.js'
import { listExercises } from './exercises.js'
import { toExercise, toPlanItem } from './mappers.js'
import { profileOf, ruleOf } from './plans.js'

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
  // Probed before init (no profile) by auth checks: nothing to resolve then.
  if (rows.length === 0) return []
  const prof = await profileOf(db, userId)
  return rows.map((r) => {
    const { rule, source } = ruleOf(toPlanItem(r.i), toExercise(r.e), prof, r.r)
    return {
      plan_id: r.p.id,
      plan_name: r.p.name,
      day_id: r.d.id,
      day_name: r.d.name,
      item_id: r.i.id,
      exercise_id: r.e.id,
      exercise_name: r.e.name,
      rule,
      ruleSource: source,
    }
  })
}

export async function listProgressionByExercise(db: Db, userId: string): Promise<ExerciseProgression[]> {
  return db.transaction(
    async (tx) => {
      const exercises = await listExercises(tx as unknown as Db, userId)
      if (exercises.length === 0) return []
      return groupProgressionByExercise(exercises, await listProgression(tx as unknown as Db, userId), await profileOf(tx, userId))
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )
}
