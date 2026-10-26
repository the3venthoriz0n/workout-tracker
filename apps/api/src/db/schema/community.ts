// Community plans (spec §5). A listing (`shared_plan`) owns the denormalized counters; each
// publish adds an immutable `shared_plan_version` holding the snapshot. Votes and counted
// downloads are one row per (user, listing). Counters change only in the same transaction as
// their rows (service/community.ts), with the listing row locked.
import { sql } from 'drizzle-orm'
import { check, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import type { SharedSnapshot } from '@workout/shared'
import { user } from './auth.js'

const ts = (name: string) => timestamp(name, { withTimezone: true })

export const sharedPlan = pgTable(
  'shared_plan',
  {
    id: uuid('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    level: text('level'),
    // published | unpublished | hidden (hidden: set by the service owner, not reversible by the sharer)
    status: text('status').notNull().default('published'),
    latestVersion: integer('latest_version').notNull(),
    upvoteCount: integer('upvote_count').notNull().default(0),
    downloadCount: integer('download_count').notNull().default(0),
    createdAt: ts('created_at').notNull().defaultNow(),
    // Time of the latest publish or status change (never bumped by votes or downloads).
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check('shared_plan_status_check', sql`${t.status} in ('published', 'unpublished', 'hidden')`),
    check('shared_plan_level_check', sql`${t.level} in ('beginner', 'intermediate', 'advanced')`),
    check('shared_plan_counts_check', sql`${t.upvoteCount} >= 0 and ${t.downloadCount} >= 0 and ${t.latestVersion} >= 1`),
    index('shared_plan_owner_idx').on(t.ownerId),
    // Public list sorts (top, new, used), over published listings only; id breaks ties for the cursor.
    index('shared_plan_top_idx')
      .on(t.upvoteCount.desc(), t.downloadCount.desc(), t.updatedAt.desc(), t.id.desc())
      .where(sql`${t.status} = 'published'`),
    index('shared_plan_new_idx')
      .on(t.updatedAt.desc(), t.id.desc())
      .where(sql`${t.status} = 'published'`),
    index('shared_plan_used_idx')
      .on(t.downloadCount.desc(), t.upvoteCount.desc(), t.updatedAt.desc(), t.id.desc())
      .where(sql`${t.status} = 'published'`),
  ],
)

export const sharedPlanVersion = pgTable(
  'shared_plan_version',
  {
    sharedPlanId: uuid('shared_plan_id')
      .notNull()
      .references(() => sharedPlan.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    // Validated by the shared zod schema on write and on read.
    snapshot: jsonb('snapshot').$type<SharedSnapshot>().notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.sharedPlanId, t.version] }),
    // The rolling publish limit counts an owner's versions by time.
    index('shared_plan_version_created_idx').on(t.createdAt),
  ],
)

export const planVote = pgTable(
  'plan_vote',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    sharedPlanId: uuid('shared_plan_id').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.sharedPlanId] }),
    foreignKey({ columns: [t.sharedPlanId], foreignColumns: [sharedPlan.id], name: 'plan_vote_shared_plan_fk' }).onDelete('cascade'),
  ],
)

export const planDownload = pgTable(
  'plan_download',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    sharedPlanId: uuid('shared_plan_id').notNull(),
    firstVersion: integer('first_version').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.sharedPlanId] }),
    foreignKey({ columns: [t.sharedPlanId], foreignColumns: [sharedPlan.id], name: 'plan_download_shared_plan_fk' }).onDelete('cascade'),
  ],
)
