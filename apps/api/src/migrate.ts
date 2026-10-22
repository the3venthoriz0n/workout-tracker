// One-shot migration runner. Run before starting a new app version.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { db, sql } from './db/index.js'

const migrationsFolder = process.env.MIGRATIONS_DIR ?? 'drizzle'

if (!existsSync(join(migrationsFolder, 'meta', '_journal.json'))) {
  console.log(`No migrations in ${migrationsFolder}; nothing to do.`)
} else {
  await migrate(db, { migrationsFolder })
  console.log('Migrations applied.')
}
await sql.end()
