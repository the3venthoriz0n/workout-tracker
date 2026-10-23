import { serveStatic } from '@hono/node-server/serve-static'
import { API_PREFIX, type Health } from '@workout/shared'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import { secureHeaders } from 'hono/secure-headers'
import type { Auth } from './auth.js'
import { sanitizeError } from './logging.js'
import type { Env } from './env.js'
import { csrfGuard, requireUser, type AppEnv } from './middleware.js'
import type { Service } from './service/index.js'

export type AppDeps = {
  auth: Auth
  env: Pick<Env, 'NODE_ENV' | 'BETTER_AUTH_URL' | 'TRUSTED_ORIGINS' | 'STATIC_DIR'>
  getService: (userId: string) => Service
  /** Resolves true when the database answers; defaults to always healthy (tests). */
  sqlHealth?: () => Promise<boolean>
}

export function createApp(deps: AppDeps): Hono {
  const { auth, env } = deps
  const app = new Hono()

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
  app.use('/api/*', csrfGuard(env))
  app.use('/api/*', bodyLimit({ maxSize: 1024 * 1024 }))

  app.get('/healthz', async (c) => {
    let ok = false
    try {
      ok = await (deps.sqlHealth?.() ?? Promise.resolve(true))
    } catch {
      ok = false
    }
    return c.json({ ok } satisfies Health, ok ? 200 : 503)
  })

  // Better Auth owns /api/auth/* (sign-up, sign-in, sign-out, get-session, ...).
  app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw))

  const v1 = new Hono<AppEnv>()
  v1.use('*', requireUser(auth))
  // Temporary probe for the middleware tests. Removed in Task 4.
  v1.get('/_whoami', (c) => c.json({ userId: c.var.userId }))
  app.route(API_PREFIX, v1)

  // Unknown API routes get a JSON 404, never the SPA.
  app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404))

  app.onError((err, c) => {
    // bodyLimit throws a 413 HTTPException when it meets an oversized chunked body.
    if (err instanceof HTTPException && err.status === 413) return c.json({ error: 'payload_too_large' }, 413)
    // Log a sanitized summary only: Drizzle messages embed the query parameters (password
    // hashes, tokens) and request data carries passwords and cookies.
    console.error('request failed', sanitizeError(err))
    return c.json({ error: 'internal_error' }, 500)
  })

  if (env.STATIC_DIR) {
    app.use('/*', serveStatic({ root: env.STATIC_DIR }))
    // SPA fallback: client-side routes load index.html.
    app.get('*', serveStatic({ root: env.STATIC_DIR, path: 'index.html' }))
  }

  return app
}
