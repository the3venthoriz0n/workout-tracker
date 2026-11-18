import { and, eq, isNull, sql } from 'drizzle-orm'
import { gearSchema, newId } from '@workout/shared'
import type { Gear } from '@workout/shared'
import { exercise, gear } from '../db/schema.js'
import type { Db } from '../db/types.js'
import { assertUuid, byName, dec, isUuid, now, toGear } from './mappers.js'

const gearInputSchema = gearSchema.pick({ id: true, name: true, owned: true, max_weight: true }).partial({ id: true })

export async function listGear(db: Db, userId: string): Promise<Gear[]> {
  const rows = await db.select().from(gear).where(and(eq(gear.userId, userId), isNull(gear.deletedAt)))
  return rows.map(toGear).sort(byName)
}

// PUT-style: an upsert on (user_id, id). created_at and deleted_at are never touched on update.
export async function saveGear(
  db: Db,
  userId: string,
  // max_weight: omitted keeps the stored limit, null clears it.
  input: { id?: string; name: string; owned: boolean; max_weight?: number | null },
): Promise<Gear> {
  const parsed = gearInputSchema.parse(input)
  const id = assertUuid(parsed.id ?? newId(), 'gear id')
  const ts = now()
  const [row] = await db
    .insert(gear)
    .values({
      id,
      userId,
      name: parsed.name,
      owned: parsed.owned,
      maxWeight: parsed.max_weight == null ? null : dec(parsed.max_weight),
      createdAt: ts,
      updatedAt: ts,
    })
    .onConflictDoUpdate({
      target: [gear.userId, gear.id],
      set: {
        name: parsed.name,
        owned: parsed.owned,
        ...(parsed.max_weight === undefined ? {} : { maxWeight: parsed.max_weight === null ? null : dec(parsed.max_weight) }),
        updatedAt: ts,
      },
    })
    .returning()
  return toGear(row!)
}

export async function deleteGear(db: Db, userId: string, id: string): Promise<void> {
  if (!isUuid(id)) return
  await db.transaction(async (tx) => {
    const ts = now()
    const [deleted] = await tx
      .update(gear)
      .set({ deletedAt: ts, updatedAt: ts })
      .where(and(eq(gear.userId, userId), eq(gear.id, id), isNull(gear.deletedAt)))
      .returning({ id: gear.id })
    if (!deleted) return
    await tx
      .update(exercise)
      .set({ requiredGearIds: sql`array_remove(${exercise.requiredGearIds}, ${id}::uuid)`, updatedAt: ts })
      .where(
        and(
          eq(exercise.userId, userId),
          isNull(exercise.deletedAt),
          sql`${id}::uuid = any(${exercise.requiredGearIds})`,
        ),
      )
  })
}
