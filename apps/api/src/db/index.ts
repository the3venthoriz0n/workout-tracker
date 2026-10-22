import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '../env.js'
import * as schema from './schema.js'

// postgres() connects lazily, on the first query.
export const sql = postgres(env.DATABASE_URL, { max: 10 })
export const db = drizzle(sql, { schema })
