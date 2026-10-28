import { APIError } from 'better-auth/api'
import { DeleteAccountBody } from '@workout/shared'
import type { Auth } from '../auth.js'
import { body, service, type Ctx } from './http.js'
import { createRateLimitStore } from './public.js'
import type { RouteDeps, V1 } from './types.js'

/** Password attempts per account, like Better Auth's sign-in limit (5 a minute). */
export const DELETE_ATTEMPTS = { max: 5, windowMs: 60_000 }

/** Checks the caller's password; returns the error response, or null when it is right. */
export type PasswordGate = (c: Ctx, password: string) => Promise<Response | null>

/**
 * The one password check for account deletion and restore: Better Auth's own server-only
 * `verifyPassword` (the same hashing as sign-in), 5 checks a minute per account, shared by every
 * route that uses the gate, so a stolen cookie gets 5 guesses a minute in total, from any address.
 */
export function createPasswordGate(auth: Auth): PasswordGate {
  const attempts = createRateLimitStore(DELETE_ATTEMPTS)
  return async (c, password) => {
    // Every password check counts (a malformed body checks nothing and is a plain 400).
    const limit = attempts.hit(c.var.userId)
    if (!limit.ok) {
      c.header('Retry-After', String(Math.max(1, Math.ceil(limit.retryAfterMs / 1000))))
      return c.json({ error: 'rate_limited' }, 429)
    }
    try {
      await auth.api.verifyPassword({ body: { password }, headers: c.req.raw.headers })
    } catch (err) {
      // Wrong password (or no password account): one answer, nothing else revealed.
      if (err instanceof APIError && err.statusCode === 400) return c.json({ error: 'invalid_password' }, 403)
      throw err
    }
    return null
  }
}

/**
 * DELETE /api/v1/account `{ password }`: deletes the caller's account (spec §9). It acts on the
 * session user only; there is no id to point at anyone else.
 *
 * The password is checked with Better Auth's own server-only `verifyPassword` (the same hashing as
 * sign-in). Better Auth's `deleteUser` is not used: it skips the password when the session is
 * fresh and cannot run our community clean-up in the same transaction.
 */
export function registerAccount(v1: V1, { getService, auth, passwordGate }: RouteDeps) {
  v1.delete('/account', async (c) => {
    const { password } = await body(c, DeleteAccountBody)
    const denied = await passwordGate(c, password)
    if (denied) return denied
    const headers = c.req.raw.headers
    await service(c, getService).deleteAccount()
    // The session row is gone with the user; expire the cookies with Better Auth's own names and
    // attributes, and tell requireUser not to forward a refreshed session cookie after this.
    c.set('sessionEnded', true)
    const out = await auth.api.signOut({ headers, returnHeaders: true }).catch(() => undefined)
    for (const cookie of out?.headers.getSetCookie() ?? []) c.header('set-cookie', cookie, { append: true })
    return c.body(null, 204)
  })
}
