// Applies the committed Drizzle migrations. Idempotent (applied ones are skipped) and loud:
// a missing migrations folder or a failing statement throws, so the process never serves
// against a missing or half-built schema.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import type { Db } from './db/types.js'

export function migrationsFolder(): string {
  return process.env.MIGRATIONS_DIR ?? 'drizzle'
}

export async function runMigrations(db: Db, folder = migrationsFolder()): Promise<void> {
  if (!existsSync(join(folder, 'meta', '_journal.json'))) {
    throw new Error(`Migrations not found in ${folder} (set MIGRATIONS_DIR)`)
  }
  await migrate(db, { migrationsFolder: folder })
}
