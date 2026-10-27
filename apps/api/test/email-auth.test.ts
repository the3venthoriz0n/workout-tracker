// M2b: email verification before the first sign-in, and password reset by email (Better Auth 1.7.12
// endpoints: POST /sign-up/email, GET /verify-email, POST /send-verification-email,
// POST /request-password-reset, POST /reset-password).
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { session, user, verification } from '../src/db/schema.js'
import { createCaptureMailer, setupEmail, throttled, type Mail, type Mailer } from '../src/mail.js'
import { cookieJar, freshIp, GOOD_PASSWORD, linkIn, pathOf, setupApp, type Harness } from './helpers.js'

let h: Harness | undefined
afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  await h?.cleanup()
  h = undefined
})

const NEW_PASSWORD = 'a brand new password'
const HOUR = 60 * 60 * 1000

async function users(hh: Harness) {
  return hh.db.select().from(user)
}

function post(hh: Harness, path: string, body: unknown, ip = freshIp()) {
  return hh.request(`/api/auth${path}`, { method: 'POST', body, ip })
}

const requestReset = (hh: Harness, email: string, ip?: string) => post(hh, '/request-password-reset', { email }, ip)
const resendVerification = (hh: Harness, email: string, ip?: string) => post(hh, '/send-verification-email', { email }, ip)
const resetPassword = (hh: Harness, token: string, newPassword = NEW_PASSWORD) =>
  post(hh, '/reset-password', { token, newPassword })

async function resetToken(hh: Harness, email: string): Promise<string> {
  const link = new URL(linkIn(await hh.lastMail(email, '/reset-password')))
  return link.searchParams.get('token')!
}

/** status + body with the values that differ per call (ids, timestamps) replaced by their type. */
async function shape(res: Response) {
  const body = (await res.json()) as unknown
  const strip = (v: unknown): unknown =>
    v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, strip(x)])) : typeof v
  return { status: res.status, body: strip(body) }
}

describe('sign-up sends a verification link and creates no session', () => {
  it('sends exactly one mail with a link built from BETTER_AUTH_URL; no cookie; the link verifies without signing in', async () => {
    h = await setupApp()
    const up = await h.signUp('New@Example.com')
    expect(up.status).toBe(200)
    expect(up.headers.getSetCookie()).toEqual([])
    expect(((await up.json()) as { token: unknown }).token).toBeNull()
    await new Promise((r) => setImmediate(r))
    expect(h.mail.sent).toHaveLength(1)
    const mail = h.mail.sent[0]!
    expect(mail.to).toBe('new@example.com')
    const link = new URL(linkIn(mail))
    expect(link.origin).toBe(new URL(h.env.BETTER_AUTH_URL).origin)
    expect(link.pathname).toBe('/api/auth/verify-email')
    expect(link.searchParams.get('callbackURL')).toBe('/verified')
    expect(mail.subject).not.toContain(link.searchParams.get('token')!)

    // Before verifying: the right password gets 403 EMAIL_NOT_VERIFIED, no cookie.
    const early = await h.signIn('new@example.com', GOOD_PASSWORD)
    expect(early.status).toBe(403)
    expect(((await early.json()) as { code: string }).code).toBe('EMAIL_NOT_VERIFIED')
    expect(early.headers.getSetCookie()).toEqual([])
    // A wrong password still gets the generic 401, so the 403 never confirms an address on its own.
    expect((await h.signIn('new@example.com', 'wrong password!')).status).toBe(401)

    // Opened on another device (no cookie, no Origin): verified, redirected, no session created there.
    const opened = await h.request(pathOf(link.href), { ip: freshIp() })
    expect(opened.status).toBe(302)
    expect(opened.headers.get('location')).toBe('/verified')
    expect(opened.headers.getSetCookie()).toEqual([])
    expect(opened.headers.get('referrer-policy')).toBe('no-referrer')
    expect(await h.db.select().from(session)).toHaveLength(0)
    expect((await users(h))[0]!.emailVerified).toBe(true)

    // The original device can now sign in.
    const ok = await h.signIn('new@example.com', GOOD_PASSWORD, { ip: freshIp() })
    expect(ok.status).toBe(200)
    expect((await h.request('/api/v1/progression', { cookie: cookieJar(ok) })).status).toBe(200)

    // Opening the link again changes nothing and still lands on /verified.
    const again = await h.request(pathOf(link.href), { ip: freshIp() })
    expect(again.status).toBe(302)
    expect(again.headers.get('location')).toBe('/verified')
  })

  it('links never use the request Host or forwarded host', async () => {
    h = await setupApp({ NODE_ENV: 'production' })
    const res = await h.app.request('http://evil.example/api/auth/sign-up/email', {
      method: 'POST',
      headers: {
        origin: h.origin,
        'content-type': 'application/json',
        host: 'evil.example',
        'x-forwarded-host': 'evil.example',
        'x-forwarded-proto': 'http',
        'x-test-client-ip': freshIp(),
      },
      body: JSON.stringify({ email: 'host@example.com', password: GOOD_PASSWORD, name: 'x', callbackURL: '/somewhere-else' }),
    })
    expect(res.status).toBe(200)
    await new Promise((r) => setImmediate(r))
    const mail = h.mail.sent.at(-1)!
    const link = new URL(linkIn(mail))
    expect(link.origin).toBe(h.env.BETTER_AUTH_URL)
    expect(link.searchParams.get('callbackURL')).toBe('/verified')
    expect(mail.text + mail.html).not.toContain('evil.example')

    // A foreign callbackURL is refused outright by Better Auth's origin check, before anything is written.
    const foreign = await h.signUp('foreign@example.com', GOOD_PASSWORD, { body: { email: 'foreign@example.com', password: GOOD_PASSWORD, name: 'x', callbackURL: 'https://evil.example/x' } })
    expect(foreign.status).toBe(403)
    expect((await users(h)).map((u) => u.email)).toEqual(['host@example.com'])

    await requestReset(h, 'host@example.com')
    const reset = new URL(linkIn(await h.lastMail('host@example.com', '/reset-password')))
    expect(reset.origin).toBe(h.env.BETTER_AUTH_URL)
  })

  it('a verification link expires after 24 hours', async () => {
    h = await setupApp()
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() })
    await h.signUp('late@example.com')
    const link = linkIn(await h.lastMail('late@example.com', '/api/auth/verify-email'))
    vi.setSystemTime(Date.now() + 25 * HOUR)
    const res = await h.request(pathOf(link), { ip: freshIp() })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/verified?error=TOKEN_EXPIRED')
    expect((await users(h))[0]!.emailVerified).toBe(false)
  })

  it('a tampered verification token is refused', async () => {
    h = await setupApp()
    await h.signUp('tamper@example.com')
    const link = new URL(linkIn(await h.lastMail('tamper@example.com', '/api/auth/verify-email')))
    link.searchParams.set('token', `${link.searchParams.get('token')!.slice(0, -2)}xx`)
    const res = await h.request(pathOf(link.href), { ip: freshIp() })
    expect(res.headers.get('location')).toBe('/verified?error=INVALID_TOKEN')
    expect((await users(h))[0]!.emailVerified).toBe(false)
  })
})

describe('sign-up never reveals whether an email has an account', () => {
  it('an existing email (any letter case, verified or not) gets the same answer as a new one and creates nothing; only an unverified one gets a set-up link', async () => {
    h = await setupApp()
    const fresh = await h.signUp('first@example.com')
    expect(fresh.status).toBe(200)
    await h.signUpVerified('verified@example.com')
    const before = h.mail.sent.length
    const freshShape = await shape(fresh)

    for (const email of ['first@example.com', 'FIRST@Example.com', 'verified@example.com', 'Verified@EXAMPLE.com']) {
      const dup = await h.signUp(email, 'some other password', { ip: freshIp() })
      expect(dup.headers.getSetCookie(), email).toEqual([])
      expect(await shape(dup), email).toEqual(freshShape)
    }
    await new Promise((r) => setTimeout(r, 50))
    expect(await users(h)).toHaveLength(2)
    // The verified account gets nothing; the unverified one gets a "choose your password" link per attempt.
    const sent = h.mail.sent.slice(before)
    expect(sent.map((m) => m.to)).toEqual(['first@example.com', 'first@example.com'])
    for (const m of sent) {
      expect(m.subject).toBe(setupEmail('x@example.com', 'https://example.invalid/').subject)
      expect(new URL(linkIn(m)).pathname).toBe('/reset-password')
    }
    // Nothing changed yet: the first password still works once verified and the attempted one does not.
    await h.verify('first@example.com')
    expect((await h.signIn('first@example.com', GOOD_PASSWORD, { ip: freshIp() })).status).toBe(200)
    expect((await h.signIn('first@example.com', 'some other password', { ip: freshIp() })).status).toBe(401)
  })

  it('the allowlist still refuses unlisted emails before anything else, and listed ones must verify', async () => {
    h = await setupApp({ SIGNUP_ALLOWLIST: ['listed@example.com'] })
    const no = await h.signUp('other@example.com')
    expect(no.status).toBe(403)
    expect(await no.json()).toEqual({ code: 'SIGNUP_CLOSED', message: 'signup_closed' })
    expect((await h.signUp('Listed@example.com')).status).toBe(200)
    expect((await h.signIn('listed@example.com', GOOD_PASSWORD)).status).toBe(403)
    // A second sign-up for the listed address now looks like the first (no "already registered").
    const again = await h.signUp('listed@example.com', 'some other password', { ip: freshIp() })
    expect(again.status).toBe(200)
    await h.verify('listed@example.com')
    expect((await h.signIn('listed@example.com', GOOD_PASSWORD, { ip: freshIp() })).status).toBe(200)
    await new Promise((r) => setTimeout(r, 50))
    // The verification link, then the set-up link of the second (duplicate) sign-up.
    expect(h.mail.sent.map((m) => [m.to, new URL(linkIn(m)).pathname])).toEqual([
      ['listed@example.com', '/api/auth/verify-email'],
      ['listed@example.com', '/reset-password'],
    ])
  })
})

describe('send-verification-email', () => {
  it('answers unknown, unverified and verified addresses identically; mails only the unverified one', async () => {
    h = await setupApp()
    await h.signUp('pending@example.com')
    await h.signUpVerified('done@example.com')
    const before = h.mail.sent.length
    const answers = []
    for (const email of ['nobody@example.com', 'pending@example.com', 'PENDING@example.com', 'done@example.com']) {
      const res = await resendVerification(h, email)
      expect(res.headers.getSetCookie(), email).toEqual([])
      answers.push(await shape(res))
    }
    for (const a of answers) expect(a).toEqual({ status: 200, body: { status: 'boolean' } })
    await new Promise((r) => setImmediate(r))
    const sent = h.mail.sent.slice(before)
    expect(sent.map((m) => m.to)).toEqual(['pending@example.com', 'pending@example.com'])
    // The resent link works.
    await h.verify('pending@example.com')
    expect((await users(h)).find((u) => u.email === 'pending@example.com')!.emailVerified).toBe(true)
  })
})

describe('password reset', () => {
  it('unknown and known emails get the same answer; only the known one gets a link to the app', async () => {
    h = await setupApp()
    await h.signUpVerified('known@example.com')
    const before = h.mail.sent.length
    const known = await shape(await requestReset(h, 'Known@Example.com'))
    const unknown = await shape(await requestReset(h, 'unknown@example.com'))
    expect(known).toEqual(unknown)
    expect(known.status).toBe(200)
    await new Promise((r) => setImmediate(r))
    const sent = h.mail.sent.slice(before)
    expect(sent.map((m) => m.to)).toEqual(['known@example.com'])
    const link = new URL(linkIn(sent[0]!))
    expect(link.origin).toBe(new URL(h.env.BETTER_AUTH_URL).origin)
    expect(link.pathname).toBe('/reset-password')
    expect(link.searchParams.get('token')).toMatch(/^[A-Za-z0-9]{24}$/)
  })

  it('the token resets the password once, revokes every session, and only then does the old password stop working', async () => {
    h = await setupApp()
    const signedIn = await h.signUpVerified('reset@example.com')
    const jar = cookieJar(signedIn)
    expect((await h.request('/api/v1/progression', { cookie: jar })).status).toBe(200)

    await requestReset(h, 'reset@example.com')
    const token = await resetToken(h, 'reset@example.com')
    // Requesting a reset changes nothing yet.
    expect((await h.signIn('reset@example.com', GOOD_PASSWORD, { ip: freshIp() })).status).toBe(200)
    expect((await h.request('/api/v1/progression', { cookie: jar })).status).toBe(200)

    const done = await resetPassword(h, token)
    expect(done.status).toBe(200)
    expect(done.headers.getSetCookie()).toEqual([])
    expect((await h.request('/api/v1/progression', { cookie: jar })).status).toBe(401)
    expect(await h.db.select().from(session)).toHaveLength(0)
    expect((await h.signIn('reset@example.com', GOOD_PASSWORD, { ip: freshIp() })).status).toBe(401)
    expect((await h.signIn('reset@example.com', NEW_PASSWORD, { ip: freshIp() })).status).toBe(200)

    // Second use fails with a generic message and changes nothing.
    const twice = await resetPassword(h, token, 'yet another password')
    expect(twice.status).toBe(400)
    expect(((await twice.json()) as { code: string }).code).toBe('INVALID_TOKEN')
    expect((await h.signIn('reset@example.com', NEW_PASSWORD, { ip: freshIp() })).status).toBe(200)
  })

  it('a reset link expires after one hour', async () => {
    h = await setupApp()
    await h.signUpVerified('slow@example.com')
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() })
    const start = Date.now()
    await requestReset(h, 'slow@example.com')
    const early = await resetToken(h, 'slow@example.com')
    vi.setSystemTime(start + 59 * 60 * 1000)
    // Still valid just before the hour.
    expect((await resetPassword(h, early)).status).toBe(200)

    vi.setSystemTime(start + 2 * HOUR)
    const t0 = Date.now()
    await requestReset(h, 'slow@example.com')
    const late = await resetToken(h, 'slow@example.com')
    vi.setSystemTime(t0 + 61 * 60 * 1000)
    const res = await resetPassword(h, late, 'never applied password')
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('INVALID_TOKEN')
    vi.useRealTimers()
    expect((await h.signIn('slow@example.com', NEW_PASSWORD, { ip: freshIp() })).status).toBe(200)
  })

  for (const used of ['first', 'second'] as const) {
    it(`every mailed link works until one is used (the ${used}); then all of them fail`, async () => {
      h = await setupApp()
      await h.signUpVerified('twice@example.com')
      await requestReset(h, 'twice@example.com')
      const first = await resetToken(h, 'twice@example.com')
      await requestReset(h, 'twice@example.com')
      const second = await resetToken(h, 'twice@example.com')
      expect(second).not.toBe(first)
      const [use, other] = used === 'first' ? [first, second] : [second, first]
      expect((await resetPassword(h, use)).status).toBe(200)
      const late = await resetPassword(h, other, 'other link password')
      expect(late.status).toBe(400)
      expect(((await late.json()) as { code: string }).code).toBe('INVALID_TOKEN')
      expect((await h.signIn('twice@example.com', NEW_PASSWORD, { ip: freshIp() })).status).toBe(200)
      const id = (await users(h))[0]!.id
      expect(await h.db.select().from(verification).where(eq(verification.value, id))).toEqual([])
    })
  }

  it('reset tokens are stored hashed, never as sent', async () => {
    h = await setupApp()
    await h.signUpVerified('hashed@example.com')
    await requestReset(h, 'hashed@example.com')
    const token = await resetToken(h, 'hashed@example.com')
    const rows = await h.db.select().from(verification)
    expect(rows).toHaveLength(1)
    expect(JSON.stringify(rows)).not.toContain(token)
  })

  it('a used reset link also verifies the email (it proves the mailbox)', async () => {
    h = await setupApp()
    await h.signUp('unverified@example.com')
    await requestReset(h, 'unverified@example.com')
    const mail = await h.lastMail('unverified@example.com', '/reset-password')
    expect(mail.subject).toBe(setupEmail('x@example.com', 'https://example.invalid/').subject)
    expect((await resetPassword(h, new URL(linkIn(mail)).searchParams.get('token')!)).status).toBe(200)
    expect((await users(h))[0]!.emailVerified).toBe(true)
    expect((await h.signIn('unverified@example.com', NEW_PASSWORD, { ip: freshIp() })).status).toBe(200)
  })

  it('another user\'s reset request leaves my links alone', async () => {
    h = await setupApp()
    await h.signUpVerified('mine@example.com')
    await h.signUpVerified('theirs@example.com')
    await requestReset(h, 'mine@example.com')
    const mine = await resetToken(h, 'mine@example.com')
    await requestReset(h, 'theirs@example.com')
    expect((await resetPassword(h, mine)).status).toBe(200)
    // Their link is still there and still works.
    expect((await resetPassword(h, await resetToken(h, 'theirs@example.com'))).status).toBe(200)
  })

  it('an unknown or garbage token is refused generically', async () => {
    h = await setupApp()
    for (const token of ['x'.repeat(24), 'nope', '']) {
      const res = await resetPassword(h, token)
      expect(res.status, token).toBe(400)
    }
  })
})

describe('pre-registration takeover', () => {
  it('an attacker who signs up the victim\'s address first loses it once the victim signs up and sets a password', async () => {
    h = await setupApp()
    const ATTACKER = 'attacker chosen password'
    const attackerIp = freshIp()
    const unknown = await shape(await h.signUp('someone-new@example.com', GOOD_PASSWORD, { ip: freshIp() }))
    expect((await h.signUp('victim@example.com', ATTACKER, { ip: attackerIp })).status).toBe(200)
    // The attacker cannot sign in: the address is unverified.
    expect((await h.signIn('victim@example.com', ATTACKER, { ip: attackerIp })).status).toBe(403)

    // The victim signs up later: same answer as for a new address, and a "choose your password" link.
    const dup = await h.signUp('Victim@example.com', GOOD_PASSWORD, { ip: freshIp() })
    expect(await shape(dup)).toEqual(unknown)
    expect(dup.headers.getSetCookie()).toEqual([])
    const mail = await h.lastMail('victim@example.com', '/reset-password')
    expect(mail.subject).toBe(setupEmail('x@example.com', 'https://example.invalid/').subject)
    expect(mail.text.toLowerCase()).toContain('choose your password')

    // Suppose the attacker had a session somehow (e.g. the victim later clicked the first verification mail).
    await h.verify('victim@example.com')
    const attackerSession = await h.signIn('victim@example.com', ATTACKER, { ip: attackerIp })
    expect(attackerSession.status).toBe(200)

    // The victim follows the link and sets a password.
    const token = new URL(linkIn(mail)).searchParams.get('token')!
    expect((await resetPassword(h, token, NEW_PASSWORD)).status).toBe(200)
    expect((await h.request('/api/v1/progression', { cookie: cookieJar(attackerSession) })).status).toBe(401)
    expect((await h.signIn('victim@example.com', ATTACKER, { ip: freshIp() })).status).toBe(401)
    expect((await h.signIn('victim@example.com', NEW_PASSWORD, { ip: freshIp() })).status).toBe(200)
    expect(await users(h)).toHaveLength(2)
  })

  it('without the victim verifying first, the set-up link alone makes the account the victim\'s', async () => {
    h = await setupApp()
    await h.signUp('victim@example.com', 'attacker chosen password', { ip: freshIp() })
    await h.signUp('victim@example.com', GOOD_PASSWORD, { ip: freshIp() })
    const mail = await h.lastMail('victim@example.com', '/reset-password')
    expect((await resetPassword(h, new URL(linkIn(mail)).searchParams.get('token')!)).status).toBe(200)
    expect((await users(h))[0]!.emailVerified).toBe(true)
    expect((await h.signIn('victim@example.com', 'attacker chosen password', { ip: freshIp() })).status).toBe(401)
    expect((await h.signIn('victim@example.com', NEW_PASSWORD, { ip: freshIp() })).status).toBe(200)
  })

  it('duplicate sign-ups of an unverified address are throttled like other mail', async () => {
    const inner = createCaptureMailer()
    h = await setupApp({}, { mailer: throttled(inner) })
    await h.signUp('flood@example.com')
    for (let i = 0; i < 10; i++) expect((await h.signUp('flood@example.com', GOOD_PASSWORD, { ip: freshIp() })).status).toBe(200)
    await new Promise((r) => setTimeout(r, 50))
    expect(inner.sent.filter((m) => new URL(linkIn(m)).pathname === '/reset-password')).toHaveLength(3)
  })
})

describe('rate limits', () => {
  for (const path of ['/request-password-reset', '/send-verification-email'] as const) {
    it(`${path}: 5 per hour per IP, then 429`, async () => {
      h = await setupApp()
      const ip = freshIp()
      const statuses: number[] = []
      for (let i = 0; i < 6; i++) statuses.push((await post(h, path, { email: `rl${i}@example.com` }, ip)).status)
      expect(statuses).toEqual([200, 200, 200, 200, 200, 429])
      // Another IP is not affected.
      expect((await post(h, path, { email: 'rl@example.com' }, freshIp())).status).toBe(200)
    })
  }

  it('50 reset requests for one address from many IPs send at most 3 mails and all answer the same', async () => {
    const inner = createCaptureMailer()
    h = await setupApp({}, { mailer: throttled(inner) })
    // Sign up and verify by hand: the throttled mailer still lets this first mail through.
    await h.signUp('victim@example.com')
    await new Promise((r) => setImmediate(r))
    const verifyMail = inner.sent.find((m) => m.to === 'victim@example.com')!
    expect((await h.request(pathOf(linkIn(verifyMail)), { ip: freshIp() })).status).toBe(302)

    const answers = new Set<string>()
    for (let i = 0; i < 50; i++) {
      const email = i % 2 ? 'victim@example.com' : 'VICTIM@example.com'
      answers.add(JSON.stringify(await shape(await requestReset(h, email))))
    }
    await new Promise((r) => setImmediate(r))
    expect(answers.size).toBe(1)
    expect(inner.sent.filter((m) => new URL(linkIn(m)).pathname === '/reset-password')).toHaveLength(3)
  })
})

describe('a failing mailer never changes a response and never leaks a link', () => {
  const variants: [string, () => Mailer][] = [
    ['rejects', () => ({ send: (m: Mail) => Promise.reject(new Error(`provider said no to ${m.text}`)) })],
    [
      'throws synchronously',
      () => ({
        send: (m: Mail) => {
          throw new Error(`provider said no to ${m.text}`)
        },
      }),
    ],
    ['never settles', () => ({ send: () => new Promise<void>(() => {}) })],
  ]
  for (const [name, make] of variants) {
    it(`mailer that ${name}`, async () => {
      const lines: string[] = []
      for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
        vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
          lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
        })
      }
      const seen: Mail[] = []
      const failing = make()
      h = await setupApp({}, { mailer: { send: (m) => (seen.push(m), failing.send(m)) } })

      const up = await h.signUp('fail@example.com')
      expect(up.status).toBe(200)
      expect(up.headers.getSetCookie()).toEqual([])
      expect((await resendVerification(h, 'fail@example.com')).status).toBe(200)
      // Verify through the database, as the link never arrived.
      await h.db.update(user).set({ emailVerified: true }).where(eq(user.email, 'fail@example.com'))
      const reset = await shape(await requestReset(h, 'fail@example.com'))
      const unknown = await shape(await requestReset(h, 'nobody@example.com'))
      expect(reset).toEqual(unknown)
      expect(reset.status).toBe(200)
      await new Promise((r) => setTimeout(r, 20))

      expect(seen).toHaveLength(3)
      const out = lines.join('\n')
      for (const m of seen) {
        const link = new URL(linkIn(m))
        expect(out).not.toContain(link.href)
        for (const v of link.searchParams.values()) if (v.length > 8) expect(out).not.toContain(v)
      }
      if (name !== 'never settles') expect(out).toContain('[mail]')
    })
  }
})
