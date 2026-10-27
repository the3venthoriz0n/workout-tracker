// Community plans (spec §3, §9). Authenticated operations are scoped by the session user; the
// public reads (createPublicService) never know a user. Counters on `shared_plan` change only in
// the same transaction as the vote/download row, with the listing row locked, so they always equal
// the real row counts.
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm'
import {
  COMMUNITY,
  ConflictError,
  DELETED_AUTHOR,
  NotFoundError,
  OwnListingError,
  PublishLimitError,
  ValidationError,
  listingMetaSchema,
  nameKey,
  newId,
  planFromSnapshot,
  sharedSnapshotSchema,
  snapshotFromPlanTree,
} from '@workout/shared'
import type {
  AdoptInput,
  ListingMeta,
  SharedSnapshot,
  PlanPublished,
  PublicListPage,
  PublicListing,
  PublicPlanDetail,
  SharedListing,
  publicListQuerySchema,
} from '@workout/shared'
import type { z } from 'zod'
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
  sharedPlan,
  sharedPlanVersion,
} from '../db/schema.js'
import type { Db } from '../db/types.js'
import { listGear } from './gear.js'
import type { Tx } from './items.js'
import { byName, dec, isUuid, now, toExercise, toGear } from './mappers.js'
import { pgCode } from './pg-error.js'
import { getPlan, profileOf } from './plans.js'

const live = (userId: string) => and(eq(plan.userId, userId), isNull(plan.deletedAt))

// Public listings (spec §9): published, and the owner either has a public name or deleted the
// account (owner_id null, kept as "Deleted user"). Queries left-join the owner's profile.
const visible = and(eq(sharedPlan.status, 'published'), or(isNull(sharedPlan.ownerId), isNotNull(profile.displayName)))
/** The public author: the owner's current public name, or "Deleted user" once the account is gone. */
const authorColumn = sql<string>`coalesce(${profile.displayName}, ${DELETED_AUTHOR})`

/** The caller's own listing of each plan that has one (for Plan.published). */
export async function publishedOf(
  db: Db | Tx,
  userId: string,
  rows: { id: string; sharedPlanId: string | null }[],
): Promise<Map<string, PlanPublished>> {
  const out = new Map<string, PlanPublished>()
  const linked = rows.filter((r) => r.sharedPlanId !== null)
  if (linked.length === 0) return out
  const listings = await db
    .select({ id: sharedPlan.id, version: sharedPlan.latestVersion, status: sharedPlan.status })
    .from(sharedPlan)
    .where(and(eq(sharedPlan.ownerId, userId), inArray(sharedPlan.id, linked.map((r) => r.sharedPlanId!))))
  const byId = new Map(listings.map((l) => [l.id, l]))
  for (const r of linked) {
    const l = byId.get(r.sharedPlanId!)
    if (l) out.set(r.id, { shared_plan_id: l.id, version: l.version, status: l.status as PlanPublished['status'] })
  }
  return out
}

/** Search and filter columns of a version (spec §9): the public list never expands the jsonb. */
function searchColumns(meta: { title: string; description: string }, snapshot: SharedSnapshot) {
  const items = snapshot.days.flatMap((d) => d.items)
  return {
    searchText: nameKey([meta.title, meta.description, ...items.map((i) => i.exercise)].join(' ')),
    noGear: items.every((i) => i.gear.length === 0),
    dayCount: snapshot.days.length,
  }
}

function parseMeta(raw: ListingMeta) {
  const r = listingMetaSchema.safeParse(raw)
  if (!r.success) {
    const issue = r.error.issues[0]
    throw new ValidationError(issue?.path.map(String).join('.') ?? '', issue?.message ?? 'Invalid')
  }
  return r.data
}

export async function publishPlan(
  db: Db,
  userId: string,
  planId: string,
  rawMeta: ListingMeta,
): Promise<{ shared_plan_id: string; version: number }> {
  const meta = parseMeta(rawMeta)
  if (!isUuid(planId)) throw new NotFoundError('Plan')
  // Ownership first, so another user's plan is the same 404 as a random id.
  const tree = await getPlan(db, userId, planId)
  if (!tree) throw new NotFoundError('Plan')
  const prof = await profileOf(db, userId)
  if (!prof.display_name) throw new ValidationError('display_name', 'Set a public name before sharing a plan')
  const snapshot = snapshotFromPlanTree(tree, prof.units, await listGear(db, userId))

  return db.transaction(async (tx) => {
    // One publish at a time per account, so the limit checks and the insert are atomic.
    await tx.select({ id: profile.userId }).from(profile).where(eq(profile.userId, userId)).for('update')
    const [row] = await tx
      .select({ id: plan.id, sharedPlanId: plan.sharedPlanId })
      .from(plan)
      .where(and(live(userId), eq(plan.id, planId)))
      .for('update')
    if (!row) throw new NotFoundError('Plan')
    const [existing] = row.sharedPlanId
      ? await tx
          .select()
          .from(sharedPlan)
          .where(and(eq(sharedPlan.id, row.sharedPlanId), eq(sharedPlan.ownerId, userId)))
          .for('update')
      : []
    if (existing?.status === 'hidden') throw new ConflictError('This listing was hidden')

    // Rolling 24 hours from stored rows: every version is one publish operation.
    const [recent] = await tx
      .select({ n: count() })
      .from(sharedPlanVersion)
      .innerJoin(sharedPlan, eq(sharedPlan.id, sharedPlanVersion.sharedPlanId))
      .where(and(eq(sharedPlan.ownerId, userId), sql`${sharedPlanVersion.createdAt} > now() - interval '24 hours'`))
    if ((recent?.n ?? 0) >= COMMUNITY.publishesPerDay) throw new PublishLimitError()
    if (existing?.status !== 'published') {
      const [liveCount] = await tx
        .select({ n: count() })
        .from(sharedPlan)
        .where(and(eq(sharedPlan.ownerId, userId), eq(sharedPlan.status, 'published')))
      if ((liveCount?.n ?? 0) >= COMMUNITY.liveListings) throw new PublishLimitError()
    }

    const ts = now()
    const fields = { title: meta.title, description: meta.description, level: meta.level, status: 'published', updatedAt: ts }
    if (existing) {
      const version = existing.latestVersion + 1
      await tx.insert(sharedPlanVersion).values({ sharedPlanId: existing.id, version, snapshot, ...searchColumns(meta, snapshot), createdAt: ts })
      await tx.update(sharedPlan).set({ ...fields, latestVersion: version }).where(eq(sharedPlan.id, existing.id))
      return { shared_plan_id: existing.id, version }
    }
    const id = newId()
    await tx.insert(sharedPlan).values({ id, ownerId: userId, ...fields, latestVersion: 1, createdAt: ts })
    await tx.insert(sharedPlanVersion).values({ sharedPlanId: id, version: 1, snapshot, ...searchColumns(meta, snapshot), createdAt: ts })
    await tx.update(plan).set({ sharedPlanId: id }).where(and(eq(plan.userId, userId), eq(plan.id, planId)))
    return { shared_plan_id: id, version: 1 }
  })
}

/** Idempotent; a hidden listing stays hidden. 404 when the plan is not the caller's or was never published. */
export async function unpublishPlan(db: Db, userId: string, planId: string): Promise<void> {
  if (!isUuid(planId)) throw new NotFoundError('Plan')
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ sharedPlanId: plan.sharedPlanId })
      .from(plan)
      .where(and(live(userId), eq(plan.id, planId)))
    if (!row?.sharedPlanId) throw new NotFoundError('Plan')
    await unpublishListing(tx, userId, row.sharedPlanId)
  })
}

/** Used by unpublish and by deleting the plan. */
export async function unpublishListing(tx: Tx, userId: string, sharedPlanId: string): Promise<void> {
  await tx
    .update(sharedPlan)
    .set({ status: 'unpublished', updatedAt: now() })
    .where(and(eq(sharedPlan.id, sharedPlanId), eq(sharedPlan.ownerId, userId), eq(sharedPlan.status, 'published')))
}

export async function listMyShared(db: Db, userId: string): Promise<SharedListing[]> {
  const rows = await db
    .select({ l: sharedPlan, planId: plan.id })
    .from(sharedPlan)
    .leftJoin(plan, and(eq(plan.userId, sharedPlan.ownerId), eq(plan.sharedPlanId, sharedPlan.id), isNull(plan.deletedAt)))
    .where(eq(sharedPlan.ownerId, userId))
    .orderBy(asc(sharedPlan.createdAt), asc(sharedPlan.id))
  return rows.map(({ l, planId }) => ({
    id: l.id,
    plan_id: planId,
    title: l.title,
    description: l.description,
    level: l.level as SharedListing['level'],
    status: l.status as SharedListing['status'],
    version: l.latestVersion,
    upvotes: l.upvoteCount,
    downloads: l.downloadCount,
    created_at: l.createdAt.toISOString(),
    updated_at: l.updatedAt.toISOString(),
  }))
}

/** Locks a published listing (or 404): serializes votes, downloads and status changes on it. */
// ownerId is null for a listing kept after its owner deleted the account: nobody owns it.
async function lockPublished(tx: Tx, id: string): Promise<{ ownerId: string | null }> {
  const [row] = await tx
    .select({ ownerId: sharedPlan.ownerId })
    .from(sharedPlan)
    .where(and(eq(sharedPlan.id, id), eq(sharedPlan.status, 'published')))
    .for('update')
  if (!row) throw new NotFoundError('Shared plan')
  return row
}

export async function setVote(db: Db, userId: string, id: string, voted: boolean): Promise<{ upvotes: number }> {
  if (!isUuid(id)) throw new NotFoundError('Shared plan')
  return db.transaction(async (tx) => {
    const { ownerId } = await lockPublished(tx, id)
    if (voted && ownerId === userId) throw new OwnListingError()
    const changed = voted
      ? await tx.insert(planVote).values({ userId, sharedPlanId: id, createdAt: now() }).onConflictDoNothing().returning({ id: planVote.sharedPlanId })
      : await tx
          .delete(planVote)
          .where(and(eq(planVote.userId, userId), eq(planVote.sharedPlanId, id)))
          .returning({ id: planVote.sharedPlanId })
    const delta = changed.length === 0 ? 0 : voted ? 1 : -1
    const [row] = await tx
      .update(sharedPlan)
      .set({ upvoteCount: sql`${sharedPlan.upvoteCount} + ${delta}` })
      .where(eq(sharedPlan.id, id))
      .returning({ upvotes: sharedPlan.upvoteCount })
    return { upvotes: row!.upvotes }
  })
}

export async function hasVoted(db: Db, userId: string, id: string): Promise<boolean> {
  if (!isUuid(id)) throw new NotFoundError('Shared plan')
  const [l] = await db.select({ id: sharedPlan.id }).from(sharedPlan).where(and(eq(sharedPlan.id, id), eq(sharedPlan.status, 'published')))
  if (!l) throw new NotFoundError('Shared plan')
  const [v] = await db
    .select({ id: planVote.sharedPlanId })
    .from(planVote)
    .where(and(eq(planVote.userId, userId), eq(planVote.sharedPlanId, id)))
  return v !== undefined
}

/**
 * Copies a published listing into the caller's account. The snapshot is always loaded from the
 * database by id; anything the client sent besides the version is ignored. Every call is a new
 * copy; the download is counted once per user.
 */
export async function adoptSharedPlan(db: Db, userId: string, input: AdoptInput): Promise<{ plan_id: string }> {
  const id = input.shared_plan_id
  if (!isUuid(id)) throw new NotFoundError('Shared plan')
  if (input.version !== undefined && !(Number.isInteger(input.version) && input.version >= 1 && input.version <= 1_000_000)) {
    throw new ValidationError('version', 'Invalid version')
  }
  const prof = await profileOf(db, userId)
  const [listing] = await db
    .select({ title: sharedPlan.title, latest: sharedPlan.latestVersion, author: authorColumn })
    .from(sharedPlan)
    .leftJoin(profile, eq(profile.userId, sharedPlan.ownerId))
    .where(and(eq(sharedPlan.id, id), visible))
  if (!listing) throw new NotFoundError('Shared plan')
  const version = input.version ?? listing.latest
  const [stored] = await db
    .select({ snapshot: sharedPlanVersion.snapshot })
    .from(sharedPlanVersion)
    .where(and(eq(sharedPlanVersion.sharedPlanId, id), eq(sharedPlanVersion.version, version)))
  if (!stored) throw new NotFoundError('Shared plan version')

  const source = { shared_plan_id: id, version, title: listing.title, author: listing.author }

  return db.transaction(async (tx) => {
    // Unpublished meanwhile: no copy, no count.
    const { ownerId } = await lockPublished(tx, id)
    // One adopt at a time per user, and the library is read inside the transaction, so
    // concurrent adopts reuse each other's new exercises and gear instead of duplicating them.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`adopt:${userId}`}))`)
    const exercises = await tx.select().from(exercise).where(and(eq(exercise.userId, userId), isNull(exercise.deletedAt)))
    const gearRows = await tx.select().from(gear).where(and(eq(gear.userId, userId), isNull(gear.deletedAt)))
    const rows = planFromSnapshot(stored.snapshot, source, {
      userId,
      units: prof.units,
      increment: prof.weight_increment,
      exercises: exercises.map(toExercise).sort(byName),
      gear: gearRows.map(toGear).sort(byName),
      now: now().toISOString(),
      newId,
    })
    const sync = (r: { created_at: string; updated_at: string }) => ({ createdAt: new Date(r.created_at), updatedAt: new Date(r.updated_at) })
    if (rows.newGear.length > 0) {
      await tx.insert(gear).values(rows.newGear.map((g) => ({ id: g.id, userId, name: g.name, owned: g.owned, ...sync(g) })))
    }
    if (rows.newExercises.length > 0) {
      await tx.insert(exercise).values(
        rows.newExercises.map((e) => ({
          id: e.id,
          userId,
          name: e.name,
          notes: e.notes,
          videoUrl: e.video_url,
          requiredGearIds: e.required_gear_ids,
          active: e.active,
          defaultSets: e.default_sets,
          defaultReps: e.default_reps,
          defaultWeight: dec(e.default_weight),
          supportsAngle: e.supports_angle,
          defaultRule: e.default_rule,
          ...sync(e),
        })),
      )
    }
    const p = rows.plan
    await tx.insert(plan).values({ id: p.id, userId, name: p.name, archived: false, source: p.source, ...sync(p) })
    await tx
      .insert(planDay)
      .values(rows.days.map((d) => ({ id: d.id, userId, planId: d.plan_id, name: d.name, position: d.position, color: d.color, ...sync(d) })))
    await tx.insert(planItem).values(
      rows.items.map((i) => ({
        id: i.id,
        userId,
        planDayId: i.plan_day_id,
        exerciseId: i.exercise_id,
        position: i.position,
        sets: i.sets,
        reps: i.reps,
        weight: i.weight === null ? null : dec(i.weight),
        targetReps: null,
        targetWeight: null,
        angle: i.angle,
        amrapLast: i.amrap_last,
        supersetGroup: i.superset_group,
        inheritRule: i.inherit_rule,
        ...sync(i),
      })),
    )
    if (rows.rules.length > 0) {
      await tx.insert(progressionRule).values(
        rows.rules.map((r) => ({
          userId,
          planItemId: r.plan_item_id,
          successAction: r.success_action,
          successAmount: dec(r.success_amount),
          failStreakLimit: r.fail_streak_limit,
          deloadPct: dec(r.deload_pct),
          repCeiling: r.rep_ceiling,
          ...sync(r),
        })),
      )
    }
    await tx.insert(itemState).values(rows.itemStates.map((s) => ({ userId, planItemId: s.plan_item_id, failStreak: 0, ...sync(s) })))
    // The owner's own copies are never counted.
    if (ownerId === userId) return { plan_id: rows.plan.id }
    const counted = await tx
      .insert(planDownload)
      .values({ userId, sharedPlanId: id, firstVersion: version, createdAt: now() })
      .onConflictDoNothing()
      .returning({ id: planDownload.sharedPlanId })
    if (counted.length > 0) {
      await tx
        .update(sharedPlan)
        .set({ downloadCount: sql`${sharedPlan.downloadCount} + 1` })
        .where(eq(sharedPlan.id, id))
    }
    return { plan_id: rows.plan.id }
  })
}

// ------------------------------------------------------------------- public area (no user)

export type PublicQuery = z.output<typeof publicListQuerySchema>

export type PublicService = {
  listPlans(query: PublicQuery): Promise<PublicListPage>
  /** Listing plus the latest (or the given) version; undefined unless published. */
  getPlan(id: string, version?: number): Promise<PublicPlanDetail | undefined>
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`)
// Postgres' own text form of a timestamptz keeps microseconds, so the cursor is exact.
const PG_TIMESTAMP = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.\d{1,6})?[+-]\d{2}(?::\d{2})?$/
const MAX_INT = 2_147_483_647

type Cursor = { a: number; b: number; ts: string; id: string }

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify([c.a, c.b, c.ts, c.id])).toString('base64url')
}

function decodeCursor(raw: string): Cursor {
  const bad = () => new ValidationError('cursor', 'Invalid cursor')
  let v: unknown
  try {
    v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
  } catch {
    throw bad()
  }
  if (!Array.isArray(v) || v.length !== 4) throw bad()
  const [a, b, ts, id] = v as unknown[]
  const okInt = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= MAX_INT
  if (!okInt(a) || !okInt(b) || typeof ts !== 'string' || typeof id !== 'string' || !isUuid(id)) throw bad()
  const m = PG_TIMESTAMP.exec(ts)
  if (!m) throw bad()
  // Round trip: the date and time must exist as written (no Feb 30, no hour 25).
  const [, date, time] = m
  const d = new Date(`${date}T${time}Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 19) !== `${date}T${time}`) throw bad()
  return { a, b, ts, id }
}

const listingColumns = {
  id: sharedPlan.id,
  title: sharedPlan.title,
  description: sharedPlan.description,
  level: sharedPlan.level,
  author: authorColumn,
  dayCount: sharedPlanVersion.dayCount,
  version: sharedPlan.latestVersion,
  upvotes: sharedPlan.upvoteCount,
  downloads: sharedPlan.downloadCount,
  updatedAt: sharedPlan.updatedAt,
  cursorTs: sql<string>`${sharedPlan.updatedAt}::text`,
}

type ListingRow = {
  id: string
  title: string
  description: string
  level: string | null
  author: string
  dayCount: number
  version: number
  upvotes: number
  downloads: number
  updatedAt: Date
}

/** Exactly the whitelisted public fields. */
function toPublicListing(r: ListingRow): PublicListing {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    level: r.level as PublicListing['level'],
    author: r.author,
    day_count: r.dayCount,
    version: r.version,
    upvotes: r.upvotes,
    downloads: r.downloads,
    updated_at: r.updatedAt.toISOString(),
  }
}

/** Published listings whose owner has a public name (or was deleted), joined to their latest version. */
function listingQuery(db: Db) {
  return db
    .select(listingColumns)
    .from(sharedPlan)
    .innerJoin(
      sharedPlanVersion,
      and(eq(sharedPlanVersion.sharedPlanId, sharedPlan.id), eq(sharedPlanVersion.version, sharedPlan.latestVersion)),
    )
    .leftJoin(profile, eq(profile.userId, sharedPlan.ownerId))
}

export function createPublicService(db: Db): PublicService {
  return {
    async listPlans(query) {
      const conds: (SQL | undefined)[] = [visible]
      // Same normalization as the stored search_text (nameKey), so case, width and spacing match.
      const q = query.q === undefined ? '' : nameKey(query.q)
      if (q) conds.push(sql`${sharedPlanVersion.searchText} like ${`%${escapeLike(q)}%`}`)
      if (query.days !== undefined) conds.push(eq(sharedPlanVersion.dayCount, query.days))
      if (query.level !== undefined) conds.push(eq(sharedPlan.level, query.level))
      if (query.gear === 'none') conds.push(eq(sharedPlanVersion.noGear, true))
      const keys =
        query.sort === 'new'
          ? [sharedPlan.updatedAt, sharedPlan.id]
          : query.sort === 'used'
            ? [sharedPlan.downloadCount, sharedPlan.upvoteCount, sharedPlan.updatedAt, sharedPlan.id]
            : [sharedPlan.upvoteCount, sharedPlan.downloadCount, sharedPlan.updatedAt, sharedPlan.id]
      if (query.cursor !== undefined) {
        const c = decodeCursor(query.cursor)
        const ts = sql`${c.ts}::timestamptz`
        const id = sql`${c.id}::uuid`
        const values = query.sort === 'new' ? [ts, id] : [sql`${c.a}::int`, sql`${c.b}::int`, ts, id]
        conds.push(sql`(${sql.join(keys, sql`, `)}) < (${sql.join(values, sql`, `)})`)
      }
      let rows
      try {
        rows = await listingQuery(db)
          .where(and(...conds))
          .orderBy(...keys.map((k) => desc(k)))
          .limit(query.limit + 1)
      } catch (err) {
        // A cursor that passed the checks but still is no valid timestamp (data exception).
        if (query.cursor !== undefined && pgCode(err)?.startsWith('22')) throw new ValidationError('cursor', 'Invalid cursor')
        throw err
      }
      const page = rows.slice(0, query.limit)
      const last = page.at(-1)
      const next =
        rows.length > query.limit && last
          ? encodeCursor({
              a: query.sort === 'used' ? last.downloads : last.upvotes,
              b: query.sort === 'used' ? last.upvotes : last.downloads,
              ts: last.cursorTs,
              id: last.id,
            })
          : null
      return { items: page.map(toPublicListing), next_cursor: next }
    },

    async getPlan(id, version) {
      if (!isUuid(id)) return undefined
      const [row] = await listingQuery(db).where(and(visible, eq(sharedPlan.id, id)))
      if (!row) return undefined
      const v = version ?? row.version
      const [stored] = await db
        .select({ snapshot: sharedPlanVersion.snapshot })
        .from(sharedPlanVersion)
        .where(and(eq(sharedPlanVersion.sharedPlanId, id), eq(sharedPlanVersion.version, v)))
      if (!stored) return undefined
      return { listing: toPublicListing(row), version: v, snapshot: sharedSnapshotSchema.parse(stored.snapshot) }
    },
  }
}
