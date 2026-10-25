import { and, eq, inArray, isNull, type SQL } from 'drizzle-orm'
import { planItem } from '../db/schema.js'
import type { Db } from '../db/types.js'

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

/**
 * Soft-deletes the caller's live plan items matching `where` and takes them out of their
 * supersets; a group left with one live member is dissolved. Shared by every item delete so the
 * cascades stay consistent (spec §5).
 */
export async function softDeleteItemsWhere(tx: Tx, userId: string, where: SQL, ts: Date): Promise<void> {
  const live = and(eq(planItem.userId, userId), isNull(planItem.deletedAt), where)
  const rows = await tx.select({ group: planItem.supersetGroup }).from(planItem).where(live).for('update')
  if (rows.length === 0) return
  await tx.update(planItem).set({ deletedAt: ts, updatedAt: ts, supersetGroup: null }).where(live)
  await dissolveLonelyGroups(tx, userId, rows.map((r) => r.group).filter((g): g is string => g !== null), ts)
}

/** Clears the group of any of `groups` that has fewer than two live members left. */
export async function dissolveLonelyGroups(tx: Tx, userId: string, groups: string[], ts: Date): Promise<void> {
  const unique = [...new Set(groups)]
  if (unique.length === 0) return
  const members = await tx
    .select({ id: planItem.id, group: planItem.supersetGroup })
    .from(planItem)
    .where(and(eq(planItem.userId, userId), isNull(planItem.deletedAt), inArray(planItem.supersetGroup, unique)))
  const lonely = unique.filter((g) => members.filter((m) => m.group === g).length < 2)
  if (lonely.length === 0) return
  await tx
    .update(planItem)
    .set({ supersetGroup: null, updatedAt: ts })
    .where(and(eq(planItem.userId, userId), inArray(planItem.supersetGroup, lonely)))
}
