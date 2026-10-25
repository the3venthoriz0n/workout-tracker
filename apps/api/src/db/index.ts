import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '../env.js'
import * as schema from './schema.js'
import type { Db } from './types.js'

export type { Db }

// postgres() connects lazily, on the first query. NOTICEs ("already exists, skipping" from the
// idempotent migration bookkeeping on every boot) are not worth logging.
export const sql = postgres(env.DATABASE_URL, { max: 10, onnotice: () => {} })
export const db: Db = drizzle(sql, { schema })
