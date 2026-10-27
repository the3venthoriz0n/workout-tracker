import { betterAuth } from 'better-auth'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { eq } from 'drizzle-orm'
import type { Db } from './db/index.js'
import { account, session, user, verification } from './db/schema.js'
import type { Env } from './env.js'
import { sanitizedLog } from './logging.js'
import { logMailFailure, resetEmail, setupEmail, type Mail, type Mailer } from './mail.js'
import { configuredOrigins, isTrustedOrigin } from './origins.js'

export type AuthEnv = Pick<Env, 'NODE_ENV' | 'BETTER_AUTH_URL' | 'BETTER_AUTH_SECRET' | 'TRUSTED_ORIGINS'> &
  Partial<Pick<Env, 'CLIENT_IP_HEADER' | 'SIGNUP_ALLOWLIST'>>

export type AuthOptions = {
  /** Sends verification and password-reset mail. Never awaited inside a request. */
  mailer: Mailer
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

/** Where the emailed links land (SPA route, same origin as the API). Set-up links add ?setup=1. */
export const RESET_PASSWORD_PATH = '/reset-password'

export function createAuth(db: Db, env: AuthEnv, opts: AuthOptions) {
  const production = env.NODE_ENV === 'production'

  // Links are built from BETTER_AUTH_URL only, never from the request (Host, X-Forwarded-*,
  // or a client-supplied callbackURL), so a forged request cannot point a real email elsewhere.
  const link = (path: string, params: Record<string, string>) => {
    const url = new URL(path, env.BETTER_AUTH_URL)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
    return url.href
  }

  // Fire and forget: the HTTP answer never waits for, or depends on, the mail provider.
  const send = (mail: Mail) => {
    try {
      opts.mailer.send(mail).catch(logMailFailure)
    } catch (err) {
      logMailFailure(err)
    }
  }

  const ipAddressHeaders = opts.clientIpHeader ? [opts.clientIpHeader] : rateLimitIpHeaders(env)

  const allowlist = new Set(env.SIGNUP_ALLOWLIST ?? [])

  // Set right after betterAuth() returns; the sign-up hooks use it to mail the set-up link.
  let requestPasswordReset: ((email: string) => Promise<unknown>) | undefined

  const auth = betterAuth({
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
      // Sign-in needs a verified email (403 EMAIL_NOT_VERIFIED otherwise). With this on, Better
      // Auth answers a sign-up for an existing email with the same 200 shape as a new one and
      // creates nothing (no session either way, as autoSignIn is off).
      requireEmailVerification: true,
      autoSignIn: false,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      // Every mailed link stays valid (1 hour) until one is used; onPasswordReset then removes the
      // rest. Nothing here touches the database, so a known address costs no extra awaited work.
      // An unverified account gets the set-up link ("choose your password"); only the SPA reads
      // `setup`, to word the page. The token handling is identical.
      sendResetPassword: async ({ user: u, token }) => {
        if (u.emailVerified) send(resetEmail(u.email, link(RESET_PASSWORD_PATH, { token })))
        else send(setupEmail(u.email, link(RESET_PASSWORD_PATH, { token, setup: '1' })))
      },
      // A used link proves control of the mailbox: verify the email and drop every other reset
      // link of this user (sessions are already revoked by revokeSessionsOnPasswordReset).
      onPasswordReset: async ({ user: u }) => {
        await db.transaction(async (tx) => {
          await tx.delete(verification).where(eq(verification.value, u.id))
          await tx.update(user).set({ emailVerified: true, updatedAt: new Date() }).where(eq(user.id, u.id))
        })
      },
      // Pre-registration takeover: someone may have signed up this address with their own
      // password. A sign-up for an existing UNVERIFIED account mails a reset ("choose your
      // password") link instead; using it sets the password, verifies the email and revokes
      // sessions. Verified accounts get nothing. The answer is the same either way (Better Auth
      // returns its uniform 200), and the mail is never awaited.
      onExistingUserSignUp: async ({ user: u }) => {
        if (u.emailVerified || !requestPasswordReset) return
        requestPasswordReset(u.email).catch(logMailFailure)
      },
    },
    // No verification mail exists: the password is chosen only after the email is confirmed. A NEW
    // account gets the set-up link instead (the reset flow, as for a duplicate sign-up of an
    // unverified address); using it sets the password, verifies the email and revokes sessions, so
    // whatever password the sign-up request carried (the web sends a random throwaway one) is
    // replaced before anyone can sign in. Better Auth calls this hook only at sign-up (sendOnSignIn
    // is off, /send-verification-email is disabled), after the user and its credential row are
    // written (the Drizzle adapter runs without a transaction, so the rows are visible). Not awaited:
    // the answer stays the same shape and timing class as a duplicate sign-up's.
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: false,
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user: u }) => {
        requestPasswordReset?.(u.email).catch(logMailFailure)
      },
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
        '/request-password-reset': { window: 60 * 60, max: 5 },
        '/send-verification-email': { window: 60 * 60, max: 5 },
      },
    },
    // Reset tokens are stored as SHA-256 hashes, so a database leak exposes no live link.
    verification: { storeIdentifier: 'hashed' },
    // Endpoints the web app never calls, closed over HTTP (404). Several check a password or change
    // the account for whoever holds a session cookie, with only the global per-IP limit, so a stolen
    // cookie could use them as a password oracle or a takeover path. Account deletion has its own
    // route, which calls auth.api.verifyPassword directly (server calls skip this list).
    disabledPaths: [
      // No verification mails are sent (sign-up mails the set-up link), so their endpoints are closed.
      '/verify-email',
      '/send-verification-email',
      '/verify-password',
      '/change-password',
      '/change-email',
      '/update-user',
      '/delete-user',
      '/delete-user/callback',
      '/update-session',
      '/list-sessions',
      '/revoke-session',
      '/revoke-sessions',
      '/revoke-other-sessions',
      '/list-accounts',
      '/account-info',
      '/unlink-account',
      '/link-social',
      '/get-access-token',
      '/refresh-token',
    ],
  })

  requestPasswordReset = (email) => auth.api.requestPasswordReset({ body: { email } })

  return auth
}

export type Auth = ReturnType<typeof createAuth>
