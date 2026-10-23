import { and, eq, isNull } from 'drizzle-orm'
import { exerciseInputSchema, newId } from '@workout/shared'
import type { Exercise, ExerciseInput } from '@workout/shared'
import { exercise, plan, planDay, planItem } from '../db/schema.js'
import type { Db } from '../db/types.js'
import { assertUuid, byName, dec, isUuid, now, toExercise } from './mappers.js'

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
  const [row] = await db
    .insert(exercise)
    .values({ id, userId, ...fields, createdAt: ts, updatedAt: ts })
    .onConflictDoUpdate({ target: [exercise.userId, exercise.id], set: { ...fields, updatedAt: ts } })
    .returning()
  return toExercise(row!)
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
    await tx
      .update(planItem)
      .set({ deletedAt: ts, updatedAt: ts })
      .where(and(eq(planItem.userId, userId), eq(planItem.exerciseId, id), isNull(planItem.deletedAt)))
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
