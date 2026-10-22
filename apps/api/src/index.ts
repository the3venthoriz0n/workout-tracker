import { serve } from '@hono/node-server'
import { app } from './app.js'
import { sql } from './db/index.js'
import { env } from './env.js'

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
