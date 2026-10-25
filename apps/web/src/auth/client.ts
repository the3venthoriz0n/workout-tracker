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

// Typed, body-free error: the server's response text is never kept or shown.
export class AuthError extends Error {
  constructor(readonly kind: AuthErrorKind) {
    super(kind)
    this.name = 'AuthError'
  }
}

export type SessionUser = { userId: string; email: string }

export interface AuthClient {
  signUp(email: string, password: string): Promise<SessionUser>
  signIn(email: string, password: string): Promise<SessionUser>
  signOut(): Promise<void>
  session(): Promise<SessionUser | null>
}

type Opts = { fetch?: typeof fetch; baseUrl?: string }

function kindForStatus(status: number, signUp: boolean): AuthErrorKind {
  if (status === 429) return 'rate_limited'
  if (signUp && status === 422) return 'email_taken'
  if (signUp && status === 403) return 'signup_closed'
  if (status === 401) return 'invalid_credentials'
  if (status === 400) return 'invalid_input'
  return 'server'
}

export function createAuthClient(opts: Opts = {}): AuthClient {
  const base = (opts.baseUrl ?? '').replace(/\/+$/, '') + '/api/auth'
  const doFetch = (url: string, init: RequestInit) => (opts.fetch ?? globalThis.fetch)(url, init)

  async function request(path: string, init: RequestInit): Promise<Response> {
    try {
      return await doFetch(`${base}${path}`, { credentials: 'include', ...init })
    } catch {
      throw new AuthError('offline')
    }
  }
  async function post(path: string, body: unknown, signUp = false): Promise<unknown> {
    const res = await request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new AuthError(kindForStatus(res.status, signUp))
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
    async signUp(email, password) {
      return userOf(await post('/sign-up/email', { email, password, name: email }, true), email)
    },
    async signIn(email, password) {
      return userOf(await post('/sign-in/email', { email, password }), email)
    },
    async signOut() {
      await post('/sign-out', {})
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
