import { betterAuth } from 'better-auth'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import type { Db } from './db/index.js'
import { account, session, user, verification } from './db/schema.js'
import type { Env } from './env.js'
import { sanitizedLog } from './logging.js'
import { configuredOrigins, isTrustedOrigin } from './origins.js'

export type AuthEnv = Pick<Env, 'NODE_ENV' | 'BETTER_AUTH_URL' | 'BETTER_AUTH_SECRET' | 'TRUSTED_ORIGINS'> &
  Partial<Pick<Env, 'CLIENT_IP_HEADER' | 'SIGNUP_ALLOWLIST'>>

export type AuthOptions = {
  /**
   * Request header that carries the client IP for rate limiting. Default: `x-forwarded-for` in
   * production, none elsewhere. Exposed so tests can give each test its own client.
   */
  clientIpHeader?: string
}

/**
 * Request headers Better Auth may read the client IP from, for rate limiting.
 * Production: the API sits behind Caddy, which discards any client-supplied X-Forwarded-For and
 * sets it to the real peer address, so the header holds exactly one trustworthy value. Better
 * Auth only accepts a single-valued header here (a multi-valued one is treated as untrusted and
 * falls into one shared bucket). The API port must never be reachable except through the proxy.
 * Development and test: no client-controlled header at all (dev is exposed on the LAN, spec
 * section 11), otherwise anyone could pick a fresh "IP" per request and dodge the limits.
 * Better Auth then uses one shared loopback bucket.
 * CLIENT_IP_HEADER replaces the default in every environment. Set it only when the app is
 * reachable solely through a trusted proxy that sets that header and drops client copies (a
 * Cloudflare Tunnel sets cf-connecting-ip).
 */
export function rateLimitIpHeaders(env: Pick<Env, 'NODE_ENV'> & Partial<Pick<Env, 'CLIENT_IP_HEADER'>>): string[] {
  if (env.CLIENT_IP_HEADER) return [env.CLIENT_IP_HEADER]
  return env.NODE_ENV === 'production' ? ['x-forwarded-for'] : []
}

export function createAuth(db: Db, env: AuthEnv, opts: AuthOptions = {}) {
  const production = env.NODE_ENV === 'production'

  const ipAddressHeaders = opts.clientIpHeader ? [opts.clientIpHeader] : rateLimitIpHeaders(env)

  const allowlist = new Set(env.SIGNUP_ALLOWLIST ?? [])

  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: { user, session, account, verification },
    }),
    // Same policy as our CSRF guard: a fixed list plus the request's own Origin when
    // isTrustedOrigin accepts it (canonical form only, so no wildcard can sneak in).
    trustedOrigins: (request) => {
      const origin = request?.headers.get('origin') ?? undefined
      return [...configuredOrigins(env), ...(origin && isTrustedOrigin(origin, env) ? [origin] : [])]
    },
    // Better Auth logs raw error objects (Drizzle errors carry query parameters); sanitize them.
    logger: { log: sanitizedLog },
    hooks: {
      // Invite-only sign-up: exact match on the lowercased email (no plus-address or dot folding).
      // Runs before anything is written, so a refusal creates no user and no session.
      before: createAuthMiddleware(async (ctx) => {
        if (allowlist.size === 0 || ctx.path !== '/sign-up/email') return
        const email = (ctx.body as { email?: unknown } | undefined)?.email
        if (typeof email === 'string' && allowlist.has(email.toLowerCase())) return
        throw new APIError('FORBIDDEN', { code: 'SIGNUP_CLOSED', message: 'signup_closed' })
      }),
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      autoSignIn: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      // Always check the database: sign-out and expiry take effect immediately.
      cookieCache: { enabled: false },
    },
    advanced: {
      useSecureCookies: production,
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', path: '/' },
      ipAddress: { ipAddressHeaders },
      // Better Auth turns these checks off by default when NODE_ENV=test; keep them on everywhere.
      disableCSRFCheck: false,
      disableOriginCheck: false,
    },
    rateLimit: {
      enabled: true,
      storage: 'memory', // single API process
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/sign-up/email': { window: 60 * 60, max: 10 },
      },
    },
  })
}

export type Auth = ReturnType<typeof createAuth>
