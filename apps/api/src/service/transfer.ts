import { and, asc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { AlreadyHasDataError, ImportInvalidError, NotFoundError, ProfileNotFoundError, parseImport } from '@workout/shared'
import type { ExportData, SharedListing } from '@workout/shared'

type ListingLevel = SharedListing['level']
type ListingStatus = SharedListing['status']
import {
  exercise,
  gear,
  itemState,
  plan,
  planDay,
  planDownload,
  planItem,
  planVote,
  profile,
  progressionRule,
  setLog,
  sharedPlan,
  sharedPlanVersion,
  user,
  workoutSession,
} from '../db/schema.js'
import type { Db } from '../db/types.js'
import type { Tx } from './items.js'
import {
  dec,
  isUuid,
  now,
  toExercise,
  toGear,
  toItemState,
  toPlan,
  toPlanDay,
  toPlanItem,
  toProfile,
  toRule,
  toSession,
  toSetLog,
} from './mappers.js'
import { TRANSIENT, TryAgainError } from './account.js'
import { pgCode } from './pg-error.js'

export async function exportAll(db: Db, userId: string): Promise<ExportData> {
  return db.transaction(
    async (tx) => {
      const [prof] = await tx.select().from(profile).where(eq(profile.userId, userId))
      if (!prof) throw new ProfileNotFoundError()
      // Every row, soft-deleted ones included; a stable order keeps exports diffable.
      const rows = {
        gear: await tx.select().from(gear).where(eq(gear.userId, userId)).orderBy(asc(gear.createdAt), asc(gear.id)),
        exercises: await tx.select().from(exercise).where(eq(exercise.userId, userId)).orderBy(asc(exercise.createdAt), asc(exercise.id)),
        plans: await tx.select().from(plan).where(eq(plan.userId, userId)).orderBy(asc(plan.createdAt), asc(plan.id)),
        days: await tx.select().from(planDay).where(eq(planDay.userId, userId)).orderBy(asc(planDay.createdAt), asc(planDay.id)),
        items: await tx.select().from(planItem).where(eq(planItem.userId, userId)).orderBy(asc(planItem.createdAt), asc(planItem.id)),
        rules: await tx.select().from(progressionRule).where(eq(progressionRule.userId, userId)).orderBy(asc(progressionRule.createdAt), asc(progressionRule.planItemId)),
        states: await tx.select().from(itemState).where(eq(itemState.userId, userId)).orderBy(asc(itemState.createdAt), asc(itemState.planItemId)),
        sessions: await tx.select().from(workoutSession).where(eq(workoutSession.userId, userId)).orderBy(asc(workoutSession.createdAt), asc(workoutSession.id)),
        logs: await tx.select().from(setLog).where(eq(setLog.userId, userId)).orderBy(asc(setLog.createdAt), asc(setLog.sessionId), asc(setLog.position), asc(setLog.setNo), asc(setLog.id)),
        account: await tx.select({ email: user.email, createdAt: user.createdAt }).from(user).where(eq(user.id, userId)),
        listings: await tx
          .select({ l: sharedPlan, planId: plan.id })
          .from(sharedPlan)
          .leftJoin(plan, and(eq(plan.userId, sharedPlan.ownerId), eq(plan.sharedPlanId, sharedPlan.id), isNull(plan.deletedAt)))
          .where(eq(sharedPlan.ownerId, userId))
          .orderBy(asc(sharedPlan.createdAt), asc(sharedPlan.id)),
        votes: await tx.select().from(planVote).where(eq(planVote.userId, userId)).orderBy(asc(planVote.createdAt), asc(planVote.sharedPlanId)),
        downloads: await tx.select().from(planDownload).where(eq(planDownload.userId, userId)).orderBy(asc(planDownload.createdAt), asc(planDownload.sharedPlanId)),
      }
      const listingIds = rows.listings.map((r) => r.l.id)
      const versions =
        listingIds.length === 0
          ? []
          : await tx
              .select({ id: sharedPlanVersion.sharedPlanId, version: sharedPlanVersion.version, snapshot: sharedPlanVersion.snapshot, createdAt: sharedPlanVersion.createdAt })
              .from(sharedPlanVersion)
              .where(inArray(sharedPlanVersion.sharedPlanId, listingIds))
              .orderBy(asc(sharedPlanVersion.sharedPlanId), asc(sharedPlanVersion.version))
      return {
        version: 1 as const,
        exported_at: now().toISOString(),
        profile: toProfile(prof),
        gear: rows.gear.map(toGear),
        exercises: rows.exercises.map(toExercise),
        plans: rows.plans.map((r) => toPlan(r)),
        plan_days: rows.days.map(toPlanDay),
        plan_items: rows.items.map(toPlanItem),
        progression_rules: rows.rules.map(toRule),
        item_states: rows.states.map(toItemState),
        workout_sessions: rows.sessions.map(toSession),
        set_logs: rows.logs.map(toSetLog),
        ...(rows.account[0] && { account: { email: rows.account[0].email, created_at: rows.account[0].createdAt.toISOString() } }),
        community: {
          listings: rows.listings.map(({ l, planId }) => ({
            id: l.id,
            plan_id: planId,
            title: l.title,
            description: l.description,
            level: l.level as ListingLevel,
            status: l.status as ListingStatus,
            version: l.latestVersion,
            upvotes: l.upvoteCount,
            downloads: l.downloadCount,
            created_at: l.createdAt.toISOString(),
            updated_at: l.updatedAt.toISOString(),
            versions: versions
              .filter((v) => v.id === l.id)
              .map((v) => ({ version: v.version, created_at: v.createdAt.toISOString(), snapshot: v.snapshot as unknown as Record<string, unknown> })),
          })),
          votes: rows.votes.map((v) => ({ shared_plan_id: v.sharedPlanId, created_at: v.createdAt.toISOString() })),
          downloads: rows.downloads.map((d) => ({
            shared_plan_id: d.sharedPlanId,
            first_version: d.firstVersion,
            created_at: d.createdAt.toISOString(),
          })),
        },
      }
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )
}

const at = (s: string): Date => new Date(s)
const atOrNull = (s: string | null): Date | null => (s === null ? null : new Date(s))
const sync = (r: { created_at: string; updated_at: string; deleted_at: string | null }) => ({
  createdAt: at(r.created_at),
  updatedAt: at(r.updated_at),
  deletedAt: atOrNull(r.deleted_at),
})

async function insertChunked<T>(rows: T[], insert: (chunk: T[]) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < rows.length; i += 500) await insert(rows.slice(i, i + 500))
}

/** Thrown by replaceAll while one of the account's listings is published (unpublish first). */
export class HasPublishedError extends Error {
  constructor() {
    super('Unpublish your shared plans first')
    this.name = 'HasPublishedError'
  }
}

/** Whatever the database still rejects (data exceptions, constraints) is a bad file, not a server fault. */
async function asImportError<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (err) {
    const code = pgCode(err)
    if (code && (code.startsWith('22') || code.startsWith('23'))) {
      throw new ImportInvalidError('The file contains values the database rejects')
    }
    throw err
  }
}

const profileValues = (d: ExportData) => ({
  // Only billing may set the tier (spec section 10); an uploaded file never can.
  plan: 'free',
  units: d.profile.units,
  weightIncrement: dec(d.profile.weight_increment),
  defaultRule: d.profile.default_rule ?? null,
  displayName: d.profile.display_name,
  ...sync(d.profile),
})

/** First-time import: ids and timestamps are kept, the owner is forced to the caller, nothing is seeded. */
export async function importAll(db: Db, userId: string, raw: ExportData): Promise<void> {
  const d = parseImport(raw)
  await asImportError(() =>
    db.transaction(async (tx) => {
      const inserted = await tx
        .insert(profile)
        .values({ userId, ...profileValues(d) })
        .onConflictDoNothing()
        .returning({ userId: profile.userId })
      if (inserted.length === 0) throw new AlreadyHasDataError()
      await insertRows(tx, userId, d)
    }),
  )
}

/**
 * Restore (spec §3, §9): REPLACES the caller's library and history with the file, in one
 * transaction (a failure anywhere leaves the old data). Locks the user row (key share, as account
 * deletion's order expects), then the same locks as adopt (the per-user advisory lock) and publish
 * (the profile row). Refused while a listing is published. The profile row
 * stays (tier and public name: the account's name wins, the file's only fills a gap); every other
 * domain row is deleted, then the file is inserted as a first-time import does. Listings, votes and
 * downloads are not touched, so community counters cannot move. `account` and `community` in the
 * file are ignored.
 */
export async function replaceAll(db: Db, userId: string, raw: ExportData, opts: { validated?: boolean } = {}): Promise<void> {
  // The route already ran parseImport (before the password check); a direct call validates here.
  const d = opts.validated ? raw : parseImport(raw)
  // Like account deletion: a deadlock or serialization failure is retried once, then "try again".
  for (let attempt = 1; ; attempt++) {
    try {
      return await asImportError(() => replaceOnce(db, userId, d))
    } catch (err) {
      if (!TRANSIENT.has(pgCode(err) ?? '')) throw err
      if (attempt >= 2) throw new TryAgainError()
    }
  }
}

async function replaceOnce(db: Db, userId: string, d: ExportData): Promise<void> {
  await db.transaction(async (tx) => {
    // The user row first, in the same order as account deletion (which locks it for update).
    const [u] = await tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).for('key share')
    if (!u) throw new NotFoundError('Account')
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`adopt:${userId}`}))`)
    const [prof] = await tx
      .select({ displayName: profile.displayName })
      .from(profile)
      .where(eq(profile.userId, userId))
      .for('update')
    const [live] = await tx
      .select({ id: sharedPlan.id })
      .from(sharedPlan)
      .where(and(eq(sharedPlan.ownerId, userId), eq(sharedPlan.status, 'published')))
      .limit(1)
    if (live) throw new HasPublishedError()
    // Plans linked to their (unpublished or hidden) listing keep the link when the file has them, so
    // a republish adds a version to the same listing and a hidden one stays refused.
    const links = await tx
      .select({ id: plan.id, sharedPlanId: plan.sharedPlanId })
      .from(plan)
      .where(and(eq(plan.userId, userId), isNotNull(plan.sharedPlanId)))

    // Children first; the composite foreign keys would cascade anyway.
    for (const table of [setLog, workoutSession, itemState, progressionRule, planItem, planDay, plan, exercise, gear]) {
      await tx.delete(table).where(eq(table.userId, userId))
    }
    const values = { ...profileValues(d), displayName: prof?.displayName ?? d.profile.display_name }
    if (prof) await tx.update(profile).set(values).where(eq(profile.userId, userId))
    else await tx.insert(profile).values({ userId, ...values })
    await insertRows(tx, userId, d)

    const inFile = new Set(d.plans.map((p) => p.id))
    for (const l of links) {
      if (!inFile.has(l.id)) continue
      await tx.update(plan).set({ sharedPlanId: l.sharedPlanId }).where(and(eq(plan.userId, userId), eq(plan.id, l.id)))
    }
  })
}

/** Inserts every row of a validated file under `userId` (ids and timestamps kept). */
async function insertRows(tx: Tx, userId: string, d: ExportData): Promise<void> {
    await insertChunked(d.gear, (c) =>
      tx.insert(gear).values(c.map((r) => ({ id: r.id, userId, name: r.name, owned: r.owned, ...sync(r) }))),
    )
    await insertChunked(d.exercises, (c) =>
      tx.insert(exercise).values(
        c.map((r) => ({
          id: r.id,
          userId,
          name: r.name,
          notes: r.notes,
          videoUrl: r.video_url,
          requiredGearIds: r.required_gear_ids,
          active: r.active,
          defaultSets: r.default_sets,
          defaultReps: r.default_reps,
          defaultWeight: dec(r.default_weight),
          supportsAngle: r.supports_angle,
          defaultRule: r.default_rule,
          ...sync(r),
        })),
      ),
    )
    await insertChunked(d.plans, (c) =>
      // `source` travels with the plan; `published` never does (a listing belongs to the account).
      tx.insert(plan).values(c.map((r) => ({ id: r.id, userId, name: r.name, archived: r.archived, source: r.source, ...sync(r) }))),
    )
    await insertChunked(d.plan_days, (c) =>
      tx
        .insert(planDay)
        .values(c.map((r) => ({ id: r.id, userId, planId: r.plan_id, name: r.name, position: r.position, color: r.color, ...sync(r) }))),
    )
    await insertChunked(d.plan_items, (c) =>
      tx.insert(planItem).values(
        c.map((r) => ({
          id: r.id,
          userId,
          planDayId: r.plan_day_id,
          exerciseId: r.exercise_id,
          position: r.position,
          sets: r.sets,
          reps: r.reps,
          weight: r.weight === null ? null : dec(r.weight),
          targetReps: r.target_reps,
          targetWeight: r.target_weight === null ? null : dec(r.target_weight),
          angle: r.angle,
          amrapLast: r.amrap_last,
          supersetGroup: r.superset_group,
          inheritRule: r.inherit_rule,
          ...sync(r),
        })),
      ),
    )
    await insertChunked(d.progression_rules, (c) =>
      tx.insert(progressionRule).values(
        c.map((r) => ({
          userId,
          planItemId: r.plan_item_id,
          successAction: r.success_action,
          successAmount: dec(r.success_amount),
          failStreakLimit: r.fail_streak_limit,
          deloadPct: dec(r.deload_pct),
          repCeiling: r.rep_ceiling,
          ...sync(r),
        })),
      ),
    )
    await insertChunked(d.item_states, (c) =>
      tx
        .insert(itemState)
        .values(c.map((r) => ({ userId, planItemId: r.plan_item_id, failStreak: r.fail_streak, ...sync(r) }))),
    )
    await insertChunked(d.workout_sessions, (c) =>
      tx.insert(workoutSession).values(
        c.map((r) => ({
          id: r.id,
          userId,
          planDayId: r.plan_day_id,
          planName: r.plan_name,
          dayName: r.day_name,
          startedAt: at(r.started_at),
          completedAt: atOrNull(r.completed_at),
          note: r.note,
          ...sync(r),
        })),
      ),
    )
    await insertChunked(d.set_logs, (c) =>
      tx.insert(setLog).values(
        c.map((r) => ({
          id: r.id,
          userId,
          sessionId: r.session_id,
          planItemId: r.plan_item_id,
          exerciseId: r.exercise_id,
          exerciseName: r.exercise_name,
          setNo: r.set_no,
          position: r.position,
          targetReps: r.target_reps,
          targetWeight: dec(r.target_weight),
          actualReps: r.actual_reps,
          weight: dec(r.weight),
          done: r.done,
          note: r.note,
          angle: r.angle,
          amrap: r.amrap,
          seq: r.seq,
          supersetGroup: r.superset_group,
          supersetLabel: r.superset_label,
          ...sync(r),
        })),
      ),
    )
}
