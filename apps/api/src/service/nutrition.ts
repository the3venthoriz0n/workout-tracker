import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm'
import {
  NUTRITION_LIMITS,
  NotFoundError,
  ValidationError,
  isNutritionDate,
  newId,
  nutritionDateSchema,
  nutritionEntryInputSchema,
} from '@workout/shared'
import type { NutritionEntry, NutritionEntryInput } from '@workout/shared'
import { aiUsage, nutritionEntry } from '../db/schema.js'
import type { Db } from '../db/types.js'
import { assertUuid, dec, isUuid, now, toNutritionEntry } from './mappers.js'

const DAY_MS = 86_400_000
const todayUtc = (): string => new Date().toISOString().slice(0, 10)
const decOrNull = (v: number | null): string | null => (v === null ? null : dec(v))

/** Entries from `from` to `to` (inclusive, at most 366 days), by date then creation time. */
export async function listNutrition(db: Db, userId: string, from: string, to: string): Promise<NutritionEntry[]> {
  if (!nutritionDateSchema.safeParse(from).success || !nutritionDateSchema.safeParse(to).success) {
    throw new ValidationError('range', 'from and to must be dates (YYYY-MM-DD)')
  }
  const days = (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY_MS
  if (days < 0) throw new ValidationError('range', 'from must not be after to')
  if (days + 1 > NUTRITION_LIMITS.rangeDays) {
    throw new ValidationError('range', `Ask for at most ${NUTRITION_LIMITS.rangeDays} days at a time`)
  }
  const rows = await db
    .select()
    .from(nutritionEntry)
    .where(
      and(
        eq(nutritionEntry.userId, userId),
        isNull(nutritionEntry.deletedAt),
        sql`${nutritionEntry.date} >= ${from}::date and ${nutritionEntry.date} <= ${to}::date`,
      ),
    )
    .orderBy(asc(nutritionEntry.date), asc(nutritionEntry.createdAt), asc(nutritionEntry.id))
  return rows.map(toNutritionEntry)
}

// PUT-style: an upsert on (user_id, id). created_at and deleted_at are never touched on update.
export async function saveNutritionEntry(db: Db, userId: string, input: NutritionEntryInput): Promise<NutritionEntry> {
  const parsed = nutritionEntryInputSchema.parse(input)
  const id = assertUuid(parsed.id ?? newId(), 'entry id')
  if (!isNutritionDate(parsed.date, todayUtc())) {
    throw new ValidationError('date', 'Pick a date from the last year up to two days ahead')
  }
  const ts = now()
  const values = {
    date: parsed.date,
    name: parsed.name,
    quantity: parsed.quantity,
    calories: decOrNull(parsed.calories),
    proteinG: decOrNull(parsed.protein_g),
    carbsG: decOrNull(parsed.carbs_g),
    fatG: decOrNull(parsed.fat_g),
    fiberG: decOrNull(parsed.fiber_g),
    sugarG: decOrNull(parsed.sugar_g),
    sodiumMg: decOrNull(parsed.sodium_mg),
    source: parsed.source,
  }
  return db.transaction(async (tx) => {
    // One writer per user at a time, so two saves cannot both count 299 entries and both insert.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`nutrition:${userId}`}))`)
    // A day holds at most 300 entries; replacing an entry that already sits on that day is always allowed.
    const [existing] = await tx
      .select({ date: nutritionEntry.date })
      .from(nutritionEntry)
      .where(and(eq(nutritionEntry.userId, userId), eq(nutritionEntry.id, id)))
    if (!existing || existing.date !== parsed.date) {
      const [{ n } = { n: 0 }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(nutritionEntry)
        .where(
          and(
            eq(nutritionEntry.userId, userId),
            isNull(nutritionEntry.deletedAt),
            sql`${nutritionEntry.date} = ${parsed.date}::date`,
            ne(nutritionEntry.id, id),
          ),
        )
      if (n >= NUTRITION_LIMITS.perDay) {
        throw new ValidationError('date', `A day can hold at most ${NUTRITION_LIMITS.perDay} entries`)
      }
    }
    const [row] = await tx
      .insert(nutritionEntry)
      .values({ id, userId, ...values, createdAt: ts, updatedAt: ts })
      .onConflictDoUpdate({ target: [nutritionEntry.userId, nutritionEntry.id], set: { ...values, updatedAt: ts } })
      .returning()
    return toNutritionEntry(row!)
  })
}

/** Soft delete; a missing or foreign id is a silent no-op (the route answers 404 through `owns`). */
export async function deleteNutritionEntry(db: Db, userId: string, id: string): Promise<void> {
  if (!isUuid(id)) return
  const ts = now()
  await db
    .update(nutritionEntry)
    .set({ deletedAt: ts, updatedAt: ts })
    .where(and(eq(nutritionEntry.userId, userId), eq(nutritionEntry.id, id), isNull(nutritionEntry.deletedAt)))
}

/**
 * Counts one AI parse against `dailyLimit` for `today` in a single atomic statement. Returns how many
 * remain after this one, or null when the day's limit was already reached (nothing is counted then).
 */
export async function takeAiMeal(db: Db, userId: string, dailyLimit: number, today: string): Promise<number | null> {
  if (!nutritionDateSchema.safeParse(today).success) throw new NotFoundError('Usage day')
  // Fail closed: a limit that is not a positive whole number allows nothing (and counts nothing).
  if (!Number.isInteger(dailyLimit) || dailyLimit < 1) return null
  const rows = await db
    .insert(aiUsage)
    .values({ userId, usageDate: today, count: 1 })
    .onConflictDoUpdate({
      target: [aiUsage.userId, aiUsage.usageDate],
      set: { count: sql`${aiUsage.count} + 1` },
      setWhere: sql`${aiUsage.count} < ${dailyLimit}`,
    })
    .returning({ count: aiUsage.count })
  const used = rows[0]?.count
  return used === undefined || used > dailyLimit ? null : dailyLimit - used
}
