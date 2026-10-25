// One-shot migration runner (`just db-migrate`, the deploy script). The API also runs the
// same migrations on boot; both are idempotent.
import { db, sql } from './db/index.js'
import { runMigrations } from './migrations.js'

try {
  await runMigrations(db)
  console.log('Migrations applied.')
} catch (err) {
  console.error('Migration failed:', err)
  process.exitCode = 1
} finally {
  await sql.end()
}
