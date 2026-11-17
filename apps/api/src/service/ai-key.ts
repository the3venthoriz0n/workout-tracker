import { eq } from 'drizzle-orm'
import { userAiKey } from '../db/schema.js'
import type { Db } from '../db/types.js'
import { now } from './mappers.js'

export type AiKeyRow = { provider: 'openai' | 'anthropic'; baseUrl: string | null; model: string; keyEnc: string }

export async function getAiKeyRow(db: Db, userId: string): Promise<AiKeyRow | null> {
  const [row] = await db.select().from(userAiKey).where(eq(userAiKey.userId, userId))
  return row ? { provider: row.provider as AiKeyRow['provider'], baseUrl: row.baseUrl, model: row.model, keyEnc: row.keyEnc } : null
}

export async function putAiKeyRow(db: Db, userId: string, row: AiKeyRow): Promise<void> {
  const ts = now()
  await db
    .insert(userAiKey)
    .values({ userId, ...row, createdAt: ts, updatedAt: ts })
    .onConflictDoUpdate({ target: userAiKey.userId, set: { ...row, updatedAt: ts } })
}

export async function deleteAiKeyRow(db: Db, userId: string): Promise<void> {
  await db.delete(userAiKey).where(eq(userAiKey.userId, userId))
}
