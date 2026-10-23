import { createMiddleware } from 'hono/factory'
import type { Auth } from './auth.js'
import { isTrustedOrigin, type OriginEnv } from './origins.js'

export type AppEnv = { Variables: { userId: string; email: string } }

/** Session cookie required; every failure looks the same (never says why). */
export function requireUser(auth: Auth) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const result = await auth.api.getSession({ headers: c.req.raw.headers, returnHeaders: true })
    const found = result.response
    if (!found) return c.json({ error: 'unauthorized' }, 401)
    c.set('userId', found.user.id)
    c.set('email', found.user.email)
    await next()
    // Better Auth renews the session at most daily; forward the refreshed cookie so the
    // browser's expiry slides with the database row.
    for (const cookie of result.headers.getSetCookie()) c.res.headers.append('set-cookie', cookie)
  })
}

// OPTIONS is guarded like any other method: the app is same-origin and never serves CORS.
const SAFE_METHODS = new Set(['GET', 'HEAD'])

function isJson(contentType: string | undefined): boolean {
  return (contentType?.split(';')[0] ?? '').trim().toLowerCase() === 'application/json'
}

/**
 * CSRF guard for /api/*. Hono's built-in csrf() only looks at form content types, so it cannot
 * protect a JSON API. Every state-changing request must (1) carry an Origin we trust and
 * (2) declare a JSON body. There is deliberately no exception for sign-out: the client sends `{}`.
 */
export function csrfGuard(env: OriginEnv) {
  return createMiddleware(async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) return next()
    if (!isTrustedOrigin(c.req.header('origin'), env)) return c.json({ error: 'forbidden_origin' }, 403)
    if (!isJson(c.req.header('content-type'))) return c.json({ error: 'unsupported_media_type' }, 415)
    return next()
  })
}
