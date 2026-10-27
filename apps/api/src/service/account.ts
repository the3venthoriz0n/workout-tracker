// Account deletion (spec §3, §9). The password is checked by the route (Better Auth); this runs
// everything else in ONE transaction, so a failure leaves the account exactly as it was.
import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import { DELETED_AUTHOR, NotFoundError } from '@workout/shared'
import { plan, planDownload, planVote, sharedPlan, user, verification } from '../db/schema.js'
import type { Db } from '../db/types.js'

/**
 * Deletes the account and everything it owns; nothing personal stays behind.
 *
 * - The user row is locked first. Any concurrent write of this user that inserts a row needs a
 *   key-share lock on it (foreign key check), so it waits and then fails once the user is gone:
 *   no vote or download can slip in between counting and deleting.
 * - Votes and counted downloads are deleted here (not by cascade) and the counters of exactly those
 *   listings are decremented, so every counter keeps equal to its real row count.
 * - Published listings stay with no owner (shown as "Deleted user"); unpublished and hidden ones
 *   are deleted with their versions. Copies other users took keep their plan but the author name
 *   in `source` becomes "Deleted user".
 * - Deleting the user row cascades to the profile, the library, plans, history, Better Auth
 *   sessions and accounts (every session is revoked). Reset links (verification rows whose value
 *   is the user id) are deleted explicitly.
 */
export async function deleteAccount(db: Db, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [found] = await tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).for('update')
    if (!found) throw new NotFoundError('Account')

    const votes = await tx.delete(planVote).where(eq(planVote.userId, userId)).returning({ id: planVote.sharedPlanId })
    if (votes.length > 0) {
      await tx
        .update(sharedPlan)
        .set({ upvoteCount: sql`${sharedPlan.upvoteCount} - 1` })
        .where(inArray(sharedPlan.id, votes.map((v) => v.id)))
    }
    const downloads = await tx.delete(planDownload).where(eq(planDownload.userId, userId)).returning({ id: planDownload.sharedPlanId })
    if (downloads.length > 0) {
      await tx
        .update(sharedPlan)
        .set({ downloadCount: sql`${sharedPlan.downloadCount} - 1` })
        .where(inArray(sharedPlan.id, downloads.map((d) => d.id)))
    }

    const owned = await tx.select({ id: sharedPlan.id }).from(sharedPlan).where(eq(sharedPlan.ownerId, userId))
    if (owned.length > 0) {
      const ids = owned.map((l) => l.id)
      // Other users' copies named this user as the author when they were taken.
      await tx
        .update(plan)
        .set({ source: sql`jsonb_set(${plan.source}, '{author}', to_jsonb(${DELETED_AUTHOR}::text))` })
        .where(sql`${plan.source}->>'shared_plan_id' in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`)
      await tx.delete(sharedPlan).where(and(eq(sharedPlan.ownerId, userId), ne(sharedPlan.status, 'published')))
      await tx.update(sharedPlan).set({ ownerId: null }).where(eq(sharedPlan.ownerId, userId))
    }

    await tx.delete(verification).where(eq(verification.value, userId))
    await tx.delete(user).where(eq(user.id, userId))
  })
}
