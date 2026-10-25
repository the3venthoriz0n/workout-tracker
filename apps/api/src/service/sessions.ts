import { and, asc, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import {
  ConflictError,
  NotFoundError,
  SessionInProgressError,
  compareSetLogs,
  effectiveValues,
  newId,
  planSessionSets,
  progress,
  setLogSchema,
} from '@workout/shared'
import type { FinishSummary, SessionDetail, SetLog, WorkoutSession } from '@workout/shared'
import {
  exercise,
  itemState,
  plan,
  planDay,
  planItem,
  profile,
  progressionRule,
  setLog,
  workoutSession,
} from '../db/schema.js'
import type { Db } from '../db/types.js'
import { dec, isUuid, now, num, toExercise, toPlanItem, toProfile, toSession, toSetLog } from './mappers.js'
import { ruleOf } from './plans.js'
import { isUniqueViolation } from './pg-error.js'

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

const activeFilter = (userId: string) =>
  and(eq(workoutSession.userId, userId), isNull(workoutSession.completedAt), isNull(workoutSession.deletedAt))

/** Groups a session's set logs by plan item, in display order (seq, else position then set number). */
async function detailOf(tx: Tx, userId: string, session: WorkoutSession): Promise<SessionDetail> {
  const logs = (
    await tx
      .select()
      .from(setLog)
      .where(and(eq(setLog.userId, userId), eq(setLog.sessionId, session.id)))
  )
    .map(toSetLog)
    .sort(compareSetLogs)
  const groups = new Map<string, SetLog[]>()
  for (const log of logs) {
    const group = groups.get(log.plan_item_id)
    if (group) group.push(log)
    else groups.set(log.plan_item_id, [log])
  }
  const exerciseIds = [...new Set(logs.map((l) => l.exercise_id))]
  const exerciseRows =
    exerciseIds.length === 0
      ? []
      : await tx
          .select()
          .from(exercise)
          .where(and(eq(exercise.userId, userId), inArray(exercise.id, exerciseIds)))
  const exercises = new Map(exerciseRows.map((r) => [r.id, toExercise(r)]))
  const out: SessionDetail['exercises'] = []
  for (const [plan_item_id, sets] of groups) {
    const first = sets[0]
    if (!first) continue
    const ex = exercises.get(first.exercise_id)
    out.push({
      plan_item_id,
      exercise_id: first.exercise_id,
      exercise_name: first.exercise_name,
      video_url: ex?.video_url ?? null,
      notes: ex?.notes ?? '',
      sets: sets.sort((a, b) => a.set_no - b.set_no),
    })
  }
  return { ...session, exercises: out }
}

const snapshot = { isolationLevel: 'repeatable read' as const, accessMode: 'read only' as const }

export async function getActiveSession(db: Db, userId: string): Promise<SessionDetail | undefined> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(workoutSession).where(activeFilter(userId)).limit(1)
    return row ? detailOf(tx, userId, toSession(row)) : undefined
  }, snapshot)
}

export async function getSession(db: Db, userId: string, id: string): Promise<SessionDetail | undefined> {
  if (!isUuid(id)) return undefined
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(workoutSession)
      .where(and(eq(workoutSession.userId, userId), eq(workoutSession.id, id), isNull(workoutSession.deletedAt)))
    return row ? detailOf(tx, userId, toSession(row)) : undefined
  }, snapshot)
}

export async function startSession(db: Db, userId: string, planDayId: string): Promise<SessionDetail> {
  if (!isUuid(planDayId)) throw new NotFoundError('Plan day')
  let sessionId: string
  try {
    sessionId = await db.transaction(async (tx) => {
      const [active] = await tx.select({ id: workoutSession.id }).from(workoutSession).where(activeFilter(userId)).limit(1)
      if (active) throw new SessionInProgressError('A session is already in progress')
      const [day] = await tx
        .select()
        .from(planDay)
        .where(and(eq(planDay.userId, userId), eq(planDay.id, planDayId), isNull(planDay.deletedAt)))
      if (!day) throw new NotFoundError('Plan day')
      const [parent] = await tx
        .select()
        .from(plan)
        .where(and(eq(plan.userId, userId), eq(plan.id, day.planId), isNull(plan.deletedAt)))
      if (!parent) throw new NotFoundError('Plan')
      const items = await tx
        .select({ item: planItem, ex: exercise })
        .from(planItem)
        .innerJoin(exercise, and(eq(exercise.userId, planItem.userId), eq(exercise.id, planItem.exerciseId)))
        .where(and(eq(planItem.userId, userId), eq(planItem.planDayId, day.id), isNull(planItem.deletedAt)))
        .orderBy(asc(planItem.position), asc(planItem.createdAt), asc(planItem.id))

      const ts = now()
      const id = newId()
      // The partial unique index is the real guard; a concurrent start fails here with 23505.
      await tx.insert(workoutSession).values({
        id,
        userId,
        planDayId: day.id,
        planName: parent.name,
        dayName: day.name,
        startedAt: ts,
        note: '',
        createdAt: ts,
        updatedAt: ts,
      })
      const rows = items.map(({ item: itemRow, ex: exRow }) => {
        const item = toPlanItem(itemRow)
        return { item, exRow, eff: effectiveValues(item, toExercise(exRow)) }
      })
      const byId = new Map(rows.map((r) => [r.item.id, r]))
      const layout = planSessionSets(rows.map((r) => ({ ...r.item, sets: r.eff.sets })))
      const logs: (typeof setLog.$inferInsert)[] = layout.map((slot) => {
        const { item, exRow, eff } = byId.get(slot.plan_item_id)!
        return {
          id: newId(),
          userId,
          sessionId: id,
          planItemId: item.id,
          exerciseId: exRow.id,
          exerciseName: exRow.name,
          setNo: slot.set_no,
          position: item.position,
          targetReps: eff.targetReps,
          targetWeight: dec(eff.targetWeight),
          actualReps: eff.targetReps,
          weight: dec(eff.targetWeight),
          done: false,
          note: '',
          angle: item.angle,
          amrap: item.amrap_last && slot.set_no === eff.sets,
          seq: slot.seq,
          supersetGroup: slot.superset_group,
          supersetLabel: slot.superset_label,
          createdAt: ts,
          updatedAt: ts,
        }
      })
      for (let i = 0; i < logs.length; i += 500) await tx.insert(setLog).values(logs.slice(i, i + 500))
      return id
    })
  } catch (err) {
    if (isUniqueViolation(err)) throw new SessionInProgressError('A session is already in progress')
    throw err
  }
  const created = await getSession(db, userId, sessionId)
  if (!created) throw new Error('Session missing after start')
  return created
}

type SetPatch = { done?: boolean; actual_reps?: number; weight?: number; note?: string; updated_at?: string }

/** Last write wins on updated_at: a patch stamped older than the stored row changes nothing. */
export async function updateSet(db: Db, userId: string, id: string, patch: SetPatch): Promise<SetLog> {
  if (!isUuid(id)) throw new NotFoundError('Set')
  const { updated_at: stamp, ...fields } = patch
  let when: Date | undefined
  if (stamp !== undefined) {
    when = new Date(stamp)
    if (Number.isNaN(when.getTime())) throw new Error('updated_at must be an ISO timestamp')
  }
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(setLog)
      .where(and(eq(setLog.userId, userId), eq(setLog.id, id)))
      .for('update')
    if (!row) throw new NotFoundError('Set')
    const existing = toSetLog(row)
    const defined = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined))
    // Validate even when stale, so a bad patch is never silently accepted.
    const ts = when ?? now()
    const next = setLogSchema.parse({ ...existing, ...defined, updated_at: ts.toISOString() })
    if (when && when.getTime() < row.updatedAt.getTime()) return existing
    const [saved] = await tx
      .update(setLog)
      .set({
        done: next.done,
        actualReps: next.actual_reps,
        weight: dec(next.weight),
        note: next.note,
        updatedAt: ts,
      })
      .where(and(eq(setLog.userId, userId), eq(setLog.id, id)))
      .returning()
    return toSetLog(saved!)
  })
}

export async function updateSessionNote(db: Db, userId: string, id: string, note: string): Promise<void> {
  if (!isUuid(id)) throw new NotFoundError('Session')
  const updated = await db
    .update(workoutSession)
    .set({ note, updatedAt: now() })
    .where(and(eq(workoutSession.userId, userId), eq(workoutSession.id, id), isNull(workoutSession.deletedAt)))
    .returning({ id: workoutSession.id })
  if (updated.length === 0) throw new NotFoundError('Session')
}

export async function finishSession(db: Db, userId: string, id: string): Promise<FinishSummary> {
  if (!isUuid(id)) throw new NotFoundError('Session')
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(workoutSession)
      .where(and(eq(workoutSession.userId, userId), eq(workoutSession.id, id), isNull(workoutSession.deletedAt)))
      .for('update')
    if (!row) throw new NotFoundError('Session')
    if (row.completedAt !== null) throw new ConflictError('Session already completed')
    const detail = await detailOf(tx, userId, toSession(row))
    const [prof] = await tx.select().from(profile).where(eq(profile.userId, userId))
    if (!prof) throw new NotFoundError('Profile')
    const increment = num(prof.weightIncrement)
    const profileView = toProfile(prof)
    const ts = now()
    const summary: FinishSummary = []

    for (const group of detail.exercises) {
      const first = group.sets[0]
      if (!first) continue
      const [itemRow] = await tx
        .select()
        .from(planItem)
        .where(and(eq(planItem.userId, userId), eq(planItem.id, group.plan_item_id)))
        .for('update')
      const [exRow] =
        itemRow && itemRow.deletedAt === null
          ? await tx
              .select()
              .from(exercise)
              .where(and(eq(exercise.userId, userId), eq(exercise.id, itemRow.exerciseId)))
          : []
      if (!itemRow || itemRow.deletedAt !== null || !exRow) {
        const snap = { reps: first.target_reps, weight: first.target_weight }
        summary.push({ exercise_name: group.exercise_name, outcome: 'skipped', before: snap, after: { ...snap } })
        continue
      }
      const item = toPlanItem(itemRow)
      const ex = toExercise(exRow)
      const eff = effectiveValues(item, ex)
      const [ruleRow] = await tx
        .select()
        .from(progressionRule)
        .where(and(eq(progressionRule.userId, userId), eq(progressionRule.planItemId, item.id)))
      const [stateRow] = await tx
        .select()
        .from(itemState)
        .where(and(eq(itemState.userId, userId), eq(itemState.planItemId, item.id)))
      const result = progress(
        { targetReps: eff.targetReps, targetWeight: eff.targetWeight, baseReps: eff.baseReps, plannedSets: eff.sets },
        ruleOf(item, ex, profileView, ruleRow).rule,
        stateRow?.failStreak ?? 0,
        group.sets,
        increment,
      )
      // Spec §6 step 1: a skipped item changes nothing.
      if (result.outcome !== 'skipped') {
        await tx
          .update(planItem)
          .set({ targetReps: result.targetReps, targetWeight: dec(result.targetWeight), updatedAt: ts })
          .where(and(eq(planItem.userId, userId), eq(planItem.id, item.id)))
        await tx
          .insert(itemState)
          .values({ userId, planItemId: item.id, failStreak: result.failStreak, createdAt: ts, updatedAt: ts })
          .onConflictDoUpdate({
            target: [itemState.userId, itemState.planItemId],
            set: { failStreak: result.failStreak, updatedAt: ts, deletedAt: null },
          })
      }
      summary.push({
        exercise_name: group.exercise_name,
        outcome: result.outcome,
        before: { reps: eff.targetReps, weight: eff.targetWeight },
        after: { reps: result.targetReps, weight: result.targetWeight },
      })
    }
    await tx
      .update(workoutSession)
      .set({ completedAt: ts, updatedAt: ts })
      .where(and(eq(workoutSession.userId, userId), eq(workoutSession.id, id)))
    return summary
  })
}

export async function discardSession(db: Db, userId: string, id: string): Promise<void> {
  if (!isUuid(id)) return
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(workoutSession)
      .where(and(eq(workoutSession.userId, userId), eq(workoutSession.id, id)))
      .for('update')
    if (!row) return
    if (row.completedAt !== null) throw new ConflictError('Cannot discard a completed session')
    await tx.delete(setLog).where(and(eq(setLog.userId, userId), eq(setLog.sessionId, id)))
    await tx.delete(workoutSession).where(and(eq(workoutSession.userId, userId), eq(workoutSession.id, id)))
  })
}

export async function listSessions(db: Db, userId: string): Promise<WorkoutSession[]> {
  const rows = await db
    .select()
    .from(workoutSession)
    .where(
      and(eq(workoutSession.userId, userId), isNotNull(workoutSession.completedAt), isNull(workoutSession.deletedAt)),
    )
    .orderBy(desc(workoutSession.completedAt), desc(workoutSession.id))
  return rows.map(toSession)
}
