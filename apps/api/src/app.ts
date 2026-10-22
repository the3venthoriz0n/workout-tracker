import { serveStatic } from '@hono/node-server/serve-static'
import { API_PREFIX, type Health } from '@workout/shared'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { secureHeaders } from 'hono/secure-headers'
import { sql } from './db/index.js'
import { env } from './env.js'

export const app = new Hono()

app.use(
  secureHeaders({
    // 180 days, no includeSubDomains (other subdomains may not be HTTPS-only).
    strictTransportSecurity: 'max-age=15552000',
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      // shadcn/Radix set inline styles.
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
  }),
)
app.use('/api/*', bodyLimit({ maxSize: 1024 * 1024 }))

app.get('/healthz', async (c) => {
  try {
    await sql`select 1`
    return c.json({ ok: true } satisfies Health)
  } catch {
    return c.json({ ok: false } satisfies Health, 503)
  }
})

const v1 = new Hono()
app.route(API_PREFIX, v1)

// Unknown API routes get a JSON 404, never the SPA.
app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404))

app.onError((err, c) => {
  console.error(err)
  return c.json({ error: 'internal_error' }, 500)
})

if (env.STATIC_DIR) {
  app.use('/*', serveStatic({ root: env.STATIC_DIR }))
  // SPA fallback: client-side routes load index.html.
  app.get('*', serveStatic({ root: env.STATIC_DIR, path: 'index.html' }))
}
