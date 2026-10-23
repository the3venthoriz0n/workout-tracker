import { and, eq, isNull } from 'drizzle-orm'
import { exercise, gear, plan, planDay, planItem, workoutSession } from '../db/schema.js'
import type { Db } from '../db/types.js'
import { isUuid } from './mappers.js'

export type OwnedKind = 'gear' | 'exercise' | 'plan' | 'day' | 'item' | 'session'

const tables = { gear, exercise, plan, day: planDay, item: planItem, session: workoutSession } as const

/**
 * True when `id` is a live row owned by `userId`. Deletes in the Repo are silent no-ops, but the
 * HTTP API answers 404 for a missing or foreign id so nothing leaks; routes ask this first.
 */
export async function owns(db: Db, userId: string, kind: OwnedKind, id: string): Promise<boolean> {
  if (!isUuid(id)) return false
  const t = tables[kind]
  const rows = await db
    .select({ id: t.id })
    .from(t)
    .where(and(eq(t.userId, userId), eq(t.id, id), isNull(t.deletedAt)))
    .limit(1)
  return rows.length > 0
}
