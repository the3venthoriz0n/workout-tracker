export type AuthErrorKind =
  | 'invalid_credentials'
  | 'rate_limited'
  | 'offline'
  | 'email_taken'
  | 'signup_closed'
  | 'invalid_input'
  | 'server'
  | 'check_failed'
  | 'unsynced_changes'
  | 'email_not_verified'
  | 'invalid_token'
  | 'invalid_password'
  | 'session_expired'

// Typed, body-free error: the server's response text is never kept or shown.
export class AuthError extends Error {
  constructor(readonly kind: AuthErrorKind) {
    super(kind)
    this.name = 'AuthError'
  }
}

export const toKind = (e: unknown): AuthErrorKind => (e instanceof AuthError ? e.kind : 'server')

export type SessionUser = { userId: string; email: string }

export interface AuthClient {
  /** Email only: the password is chosen later through the emailed set-up link. */
  signUp(email: string): Promise<SessionUser>
  signIn(email: string, password: string): Promise<SessionUser>
  signOut(): Promise<void>
  session(): Promise<SessionUser | null>
  /** Same answer for known and unknown addresses; the server never says which. */
  resendVerification(email: string): Promise<void>
  requestPasswordReset(email: string): Promise<void>
  resetPassword(token: string, newPassword: string): Promise<void>
  /** Deletes the signed-in account (DELETE /api/v1/account); the password is checked by the server. */
  deleteAccount(password: string): Promise<void>
}

type Opts = { fetch?: typeof fetch; baseUrl?: string }

/**
 * Better Auth's sign-up needs a password, but the user chooses theirs only after confirming the
 * email (the set-up link replaces this one). 32 random bytes, base64url; sent once, never kept,
 * shown or logged. Uses getRandomValues, which also works on plain-http LAN origins.
 */
export function generateSignupPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

type Mode = 'sign-in' | 'sign-up' | 'reset'

function kindForStatus(status: number, mode: Mode, code: string): AuthErrorKind {
  const signUp = mode === 'sign-up'
  if (status === 429) return 'rate_limited'
  if (mode === 'sign-in' && status === 403 && code === 'EMAIL_NOT_VERIFIED') return 'email_not_verified'
  if (mode === 'reset' && status === 400 && code === 'INVALID_TOKEN') return 'invalid_token'
  if (signUp && status === 422) return 'email_taken'
  if (signUp && status === 403) return 'signup_closed'
  if (status === 401) return 'invalid_credentials'
  if (status === 400) return 'invalid_input'
  return 'server'
}

/** Errors of DELETE /api/v1/account; only the status is read, never the body. */
function deleteKind(status: number): AuthErrorKind {
  if (status === 429) return 'rate_limited'
  if (status === 401) return 'session_expired'
  if (status === 403 || status === 400) return 'invalid_password'
  return 'server'
}

export function createAuthClient(opts: Opts = {}): AuthClient {
  const origin = (opts.baseUrl ?? '').replace(/\/+$/, '')
  const base = origin + '/api/auth'
  const doFetch = (url: string, init: RequestInit) => (opts.fetch ?? globalThis.fetch)(url, init)

  async function request(path: string, init: RequestInit): Promise<Response> {
    try {
      return await doFetch(`${base}${path}`, { credentials: 'include', ...init })
    } catch {
      throw new AuthError('offline')
    }
  }
  async function post(path: string, body: unknown, mode: Mode = 'sign-in'): Promise<unknown> {
    const res = await request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      // Only the machine-readable code is read; message text is never kept.
      const data = await res.json().catch(() => null)
      const code = (data as { code?: unknown } | null)?.code
      throw new AuthError(kindForStatus(res.status, mode, typeof code === 'string' ? code : ''))
    }
    return res.json().catch(() => ({}))
  }
  const userOf = (data: unknown, email: string): SessionUser => {
    const u = (data as { user?: { id?: unknown; email?: unknown } } | null)?.user
    return {
      userId: typeof u?.id === 'string' ? u.id : '',
      email: typeof u?.email === 'string' ? u.email : email,
    }
  }

  return {
    // Better Auth requires a display name; the app has none, so the email is used.
    async signUp(email) {
      return userOf(await post('/sign-up/email', { email, password: generateSignupPassword(), name: email }, 'sign-up'), email)
    },
    async signIn(email, password) {
      return userOf(await post('/sign-in/email', { email, password }), email)
    },
    async signOut() {
      await post('/sign-out', {})
    },
    // For an unverified account the reset mail is the set-up link: choosing a password verifies the email.
    async resendVerification(email) {
      await post('/request-password-reset', { email })
    },
    async requestPasswordReset(email) {
      await post('/request-password-reset', { email })
    },
    async resetPassword(token, newPassword) {
      await post('/reset-password', { token, newPassword }, 'reset')
    },
    async deleteAccount(password) {
      let res: Response
      try {
        res = await doFetch(`${origin}/api/v1/account`, {
          method: 'DELETE',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
        })
      } catch {
        throw new AuthError('offline')
      }
      if (!res.ok) throw new AuthError(deleteKind(res.status))
    },
    async session() {
      const res = await request('/get-session', { method: 'GET' })
      if (res.status === 401) return null
      if (!res.ok) throw new AuthError('server')
      const data = await res.json().catch(() => null)
      const u = (data as { user?: { id?: unknown; email?: unknown } } | null)?.user
      if (!u || typeof u.id !== 'string' || typeof u.email !== 'string') return null
      return { userId: u.id, email: u.email }
    },
  }
}
