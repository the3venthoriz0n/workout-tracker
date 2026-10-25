import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { createAuth } from './auth.js'
import { db, sql } from './db/index.js'
import { env } from './env.js'
import { runMigrations } from './migrations.js'
import { createService } from './service/index.js'

// Fail loudly: if migrations cannot be applied the process exits and never serves.
try {
  await runMigrations(db)
  console.log('Migrations applied.')
} catch (err) {
  console.error('Migration failed:', err)
  process.exit(1)
}

const app = createApp({
  auth: createAuth(db, env),
  env,
  getService: (userId) => createService(db, userId),
  sqlHealth: async () => {
    try {
      await sql`select 1`
      return true
    } catch {
      return false
    }
  },
})

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`API listening on :${info.port}`)
})

// Docker sends SIGTERM on stop/deploy; finish in-flight requests, then close the DB pool.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    server.close(async () => {
      await sql.end({ timeout: 5 })
      process.exit(0)
    })
  })
}
