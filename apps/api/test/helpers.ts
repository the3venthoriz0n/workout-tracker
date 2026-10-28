import { randomBytes } from 'node:crypto'
import { createApp } from '../src/app.js'
import { createAuth } from '../src/auth.js'
import { createCaptureMailer, type Mail, type Mailer } from '../src/mail.js'
import { createPublicService } from '../src/service/community.js'
import { createService } from '../src/service/index.js'
import type { OriginEnv } from '../src/origins.js'
import { withTestDb, type TestDb } from './harness.js'

export const TEST_ORIGIN = 'https://app.example.com'
export const GOOD_PASSWORD = 'correct horse battery'

export type TestEnv = OriginEnv & {
  BETTER_AUTH_SECRET: string
  STATIC_DIR?: string
  SIGNUP_ALLOWLIST?: string[]
}

export function testEnv(over: Partial<TestEnv> = {}): TestEnv {
  const NODE_ENV = over.NODE_ENV ?? 'test'
  return {
    NODE_ENV,
    BETTER_AUTH_URL: NODE_ENV === 'production' ? TEST_ORIGIN : 'http://localhost:3000',
    BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-0000',
    TRUSTED_ORIGINS: [],
    ...over,
  }
}

export type Harness = Awaited<ReturnType<typeof setupApp>>

type ReqOpts = {
  method?: string
  body?: unknown
  rawBody?: string
  cookie?: string
  origin?: string | null
  contentType?: string | null
  ip?: string
}

/** A random client address, so a helper's own requests never use up the per-IP limits a test is measuring. */
export function freshIp(): string {
  return `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${randomBytes(1)[0]}`
}

/** The one link in a mail's text body. */
export function linkIn(mail: Mail): string {
  const links = mail.text.match(/https?:\/\/[^\s<>"]+/g) ?? []
  if (links.length !== 1) throw new Error(`expected one link in the mail, found ${links.length}`)
  return links[0]!
}

/** Path and query of an absolute link, for app.request. */
export function pathOf(link: string): string {
  const u = new URL(link)
  return u.pathname + u.search
}

/**
 * App over an isolated test schema. Each harness gets its own client IP so the process-wide rate-limit store never leaks between tests.
 * Mail goes to `mail` (a capture mailer) unless `opts.mailer` replaces it.
 */
export async function setupApp(over: Partial<TestEnv> = {}, opts: { mailer?: Mailer } = {}) {
  const t: TestDb = await withTestDb()
  const env = testEnv(over)
  const mail = createCaptureMailer()
  const auth = createAuth(t.db, env, { mailer: opts.mailer ?? mail, clientIpHeader: 'x-test-client-ip' })
  const app = createApp({
    auth,
    env,
    getService: (userId) => createService(t.db, userId),
    getPublic: () => createPublicService(t.db),
    // Tests call the public area far more often than a client would; the limiter has its own test.
    publicRateLimit: { enabled: false },
  })
  const origin = env.BETTER_AUTH_URL
  const ip = freshIp()

  function request(path: string, o: ReqOpts = {}) {
    const method = o.method ?? 'GET'
    const headers: Record<string, string> = { 'x-test-client-ip': o.ip ?? ip }
    const hasBody = o.body !== undefined || o.rawBody !== undefined
    if (o.origin !== null && (o.origin !== undefined || method !== 'GET')) headers.origin = o.origin ?? origin
    if (o.contentType !== null && (o.contentType !== undefined || hasBody)) {
      headers['content-type'] = o.contentType ?? 'application/json'
    }
    if (o.cookie) headers.cookie = o.cookie
    return app.request(path, {
      method,
      headers,
      body: o.rawBody ?? (o.body !== undefined ? JSON.stringify(o.body) : undefined),
    })
  }

  async function signUp(email: string, password = GOOD_PASSWORD, o: ReqOpts = {}) {
    return request('/api/auth/sign-up/email', {
      method: 'POST',
      body: { email, password, name: 'Test User' },
      ...o,
    })
  }

  async function signIn(email: string, password: string, o: ReqOpts = {}) {
    return request('/api/auth/sign-in/email', { method: 'POST', body: { email, password }, ...o })
  }

  /**
   * The newest captured mail to `email` whose link goes to `path`. `since` is a `mail.sent` index:
   * only mails captured at or after it count, so a caller that signs the same address up again
   * waits for the NEW mail instead of getting the old (already used) one.
   */
  async function lastMail(email: string, path: '/reset-password', since = 0): Promise<Mail> {
    // Sending is never awaited by the request (and may follow database work), so poll.
    const deadline = Date.now() + 10_000
    for (;;) {
      await new Promise((r) => setTimeout(r, 5))
      const found = mail.sent.slice(since).filter((m) => m.to === email.toLowerCase() && new URL(linkIn(m)).pathname === path).at(-1)
      if (found) return found
      if (Date.now() > deadline) throw new Error(`no ${path} mail to ${email}`)
    }
  }

  /**
   * Opens the newest set-up link mailed to `email` (as a mail client would: no cookie, no Origin)
   * and chooses `password`, which also confirms the address.
   */
  async function setUp(email: string, password = GOOD_PASSWORD, since = 0) {
    const link = new URL(linkIn(await lastMail(email, '/reset-password', since)))
    const res = await request('/api/auth/reset-password', {
      method: 'POST',
      body: { token: link.searchParams.get('token'), newPassword: password },
      ip: freshIp(),
    })
    if (res.status !== 200) throw new Error(`set-up failed: ${res.status}`)
    return res
  }

  /**
   * Sign-up, then the mailed set-up link (choosing `password`), then sign-in: the response is the
   * sign-in's (status 200, session cookie, `user`). A failed sign-up is returned as is. Set-up and
   * sign-in come from fresh addresses so they never count against the test's own per-IP limits.
   */
  async function signUpVerified(email: string, password = GOOD_PASSWORD, o: ReqOpts = {}) {
    const before = mail.sent.length
    const up = await signUp(email, password, o)
    if (up.status !== 200) return up
    await setUp(email, password, before)
    return signIn(email, password, { ...o, ip: freshIp() })
  }

  return { ...t, env, auth, app, origin, mail, request, signUp, signIn, lastMail, setUp, signUpVerified }
}

/** "name=value" pairs of all Set-Cookie headers, joined for a Cookie request header. */
export function cookieJar(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0]!)
    .filter((c) => !/=$/.test(c))
    .join('; ')
}
