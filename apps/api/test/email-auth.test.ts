// M2b + set-up links: sign-up mails a "choose your password" link (the password-reset flow), and the
// password is chosen only after the email is confirmed; password reset by email. Better Auth 1.7.12
// endpoints: POST /sign-up/email, POST /request-password-reset, POST /reset-password. The
// verification endpoints (GET /verify-email, POST /send-verification-email) are closed.
import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { session, user, verification } from '../src/db/schema.js'
import { createCaptureMailer, resetEmail, setupEmail, throttled, type Mail, type Mailer } from '../src/mail.js'
import { cookieJar, freshIp, GOOD_PASSWORD, linkIn, setupApp, type Harness } from './helpers.js'

let h: Harness | undefined
afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  await h?.cleanup()
  h = undefined
})

const NEW_PASSWORD = 'a brand new password'
const HOUR = 60 * 60 * 1000
const SETUP_SUBJECT = setupEmail('x@example.com', 'https://example.invalid/').subject
const RESET_SUBJECT = resetEmail('x@example.com', 'https://example.invalid/').subject

async function users(hh: Harness) {
  return hh.db.select().from(user)
}

function post(hh: Harness, path: string, body: unknown, ip = freshIp()) {
  return hh.request(`/api/auth${path}`, { method: 'POST', body, ip })
}

const requestReset = (hh: Harness, email: string, ip?: string) => post(hh, '/request-password-reset', { email }, ip)
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

/** Collects everything written to the console while a test runs. */
function captureLogs(): string[] {
  const lines: string[] = []
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
    })
  }
  return lines
}

// Like the web client's throwaway sign-up password: 32 random bytes, base64url.
const THROWAWAY = randomBytes(32).toString('base64url')

describe('sign-up mails the set-up link; the password is chosen only after the email is confirmed', () => {
  it('sends exactly one mail: the set-up link (BETTER_AUTH_URL, ?setup=1, a working token); no cookie; the sign-up password never leaks', async () => {
    const logs = captureLogs()
    h = await setupApp()
    const up = await h.signUp('New@Example.com', THROWAWAY)
    expect(up.status).toBe(200)
    expect(up.headers.getSetCookie()).toEqual([])
    const upText = await up.text()
    expect(JSON.parse(upText).token).toBeNull()
    const mail = await h.lastMail('new@example.com', '/reset-password')
    await new Promise((r) => setTimeout(r, 30))
    expect(h.mail.sent).toHaveLength(1)
    expect(mail.subject).toBe(SETUP_SUBJECT)
    expect(mail.text.toLowerCase()).toContain('choose your password')
    const link = new URL(linkIn(mail))
    expect(link.origin).toBe(new URL(h.env.BETTER_AUTH_URL).origin)
    expect(link.pathname).toBe('/reset-password')
    expect(link.searchParams.get('setup')).toBe('1')
    const token = link.searchParams.get('token')!
    expect(token).toMatch(/^[A-Za-z0-9]{24}$/)

    // Before the set-up link: the sign-up password gets 403 EMAIL_NOT_VERIFIED, no cookie.
    const early = await h.signIn('new@example.com', THROWAWAY)
    expect(early.status).toBe(403)
    expect(((await early.json()) as { code: string }).code).toBe('EMAIL_NOT_VERIFIED')
    expect(early.headers.getSetCookie()).toEqual([])
    // A wrong password still gets the generic 401, so the 403 never confirms an address on its own.
    expect((await h.signIn('new@example.com', 'wrong password!')).status).toBe(401)

    // Choosing the password through the link confirms the email and creates no session.
    const chosen = await resetPassword(h, token)
    expect(chosen.status).toBe(200)
    expect(chosen.headers.getSetCookie()).toEqual([])
    expect(await h.db.select().from(session)).toHaveLength(0)
    expect((await users(h))[0]!.emailVerified).toBe(true)
    expect((await h.signIn('new@example.com', THROWAWAY, { ip: freshIp() })).status).toBe(401)
    const ok = await h.signIn('new@example.com', NEW_PASSWORD, { ip: freshIp() })
    expect(ok.status).toBe(200)
    expect((await h.request('/api/v1/progression', { cookie: cookieJar(ok) })).status).toBe(200)

    // The sign-up password appears in no mail, response or log line.
    for (const m of h.mail.sent) expect(m.subject + m.text + m.html).not.toContain(THROWAWAY)
    expect(upText).not.toContain(THROWAWAY)
    expect(logs.join('\n')).not.toContain(THROWAWAY)
  })

  it('the verification endpoints are closed', async () => {
    h = await setupApp()
    await h.signUp('closed@example.com')
    await h.lastMail('closed@example.com', '/reset-password')
    expect((await h.request('/api/auth/verify-email?token=x&callbackURL=%2F', { ip: freshIp() })).status).toBe(404)
    expect((await post(h, '/send-verification-email', { email: 'closed@example.com' })).status).toBe(404)
    await new Promise((r) => setTimeout(r, 30))
    expect(h.mail.sent).toHaveLength(1)
    expect((await users(h))[0]!.emailVerified).toBe(false)
  })

  it('links never use the request Host or forwarded host, nor a client callbackURL', async () => {
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
    const mail = await h.lastMail('host@example.com', '/reset-password')
    const link = new URL(linkIn(mail))
    expect(link.origin).toBe(h.env.BETTER_AUTH_URL)
    expect([...link.searchParams.keys()].sort()).toEqual(['setup', 'token'])
    expect(mail.text + mail.html).not.toContain('evil.example')
    expect(mail.text + mail.html).not.toContain('somewhere-else')

    // A foreign callbackURL is refused outright by Better Auth's origin check, before anything is written.
    const foreign = await h.signUp('foreign@example.com', GOOD_PASSWORD, { body: { email: 'foreign@example.com', password: GOOD_PASSWORD, name: 'x', callbackURL: 'https://evil.example/x' } })
    expect(foreign.status).toBe(403)
    expect((await users(h)).map((u) => u.email)).toEqual(['host@example.com'])
  })

  it('the set-up link from sign-up expires after one hour', async () => {
    h = await setupApp()
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() })
    const start = Date.now()
    await h.signUp('late@example.com')
    const token = await resetToken(h, 'late@example.com')
    vi.setSystemTime(start + 61 * 60 * 1000)
    const res = await resetPassword(h, token)
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('INVALID_TOKEN')
    expect((await users(h))[0]!.emailVerified).toBe(false)
  })
})

describe('sign-up never reveals whether an email has an account', () => {
  it('an existing email (any letter case, verified or not) gets the same answer as a new one and creates nothing; only an unverified one gets a set-up link', async () => {
    h = await setupApp()
    const fresh = await h.signUp('first@example.com')
    expect(fresh.status).toBe(200)
    await h.signUpVerified('verified@example.com')
    await h.lastMail('first@example.com', '/reset-password')
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
      expect(m.subject).toBe(SETUP_SUBJECT)
      expect(new URL(linkIn(m)).pathname).toBe('/reset-password')
      expect(new URL(linkIn(m)).searchParams.get('setup')).toBe('1')
    }
    // Neither sign-up password works; the one chosen through the newest link does.
    await h.setUp('first@example.com', NEW_PASSWORD)
    expect((await h.signIn('first@example.com', GOOD_PASSWORD, { ip: freshIp() })).status).toBe(401)
    expect((await h.signIn('first@example.com', 'some other password', { ip: freshIp() })).status).toBe(401)
    expect((await h.signIn('first@example.com', NEW_PASSWORD, { ip: freshIp() })).status).toBe(200)
  })

  it('the allowlist still refuses unlisted emails before anything else, and listed ones must set a password first', async () => {
    h = await setupApp({ SIGNUP_ALLOWLIST: ['listed@example.com'] })
    const no = await h.signUp('other@example.com')
    expect(no.status).toBe(403)
    expect(await no.json()).toEqual({ code: 'SIGNUP_CLOSED', message: 'signup_closed' })
    expect((await h.signUp('Listed@example.com')).status).toBe(200)
    expect((await h.signIn('listed@example.com', GOOD_PASSWORD)).status).toBe(403)
    // A second sign-up for the listed address now looks like the first (no "already registered").
    const again = await h.signUp('listed@example.com', 'some other password', { ip: freshIp() })
    expect(again.status).toBe(200)
    await new Promise((r) => setTimeout(r, 50))
    await h.setUp('listed@example.com')
    expect((await h.signIn('listed@example.com', GOOD_PASSWORD, { ip: freshIp() })).status).toBe(200)
    // Two set-up links (sign-up, then the duplicate sign-up); nobody else got mail.
    expect(h.mail.sent.map((m) => [m.to, m.subject, new URL(linkIn(m)).pathname])).toEqual([
      ['listed@example.com', SETUP_SUBJECT, '/reset-password'],
      ['listed@example.com', SETUP_SUBJECT, '/reset-password'],
    ])
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
    expect(link.searchParams.get('setup')).toBeNull()
    expect(sent[0]!.subject).toBe(RESET_SUBJECT)
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
  it('an attacker who signs up the victim\'s address with a chosen password cannot sign in, and the victim\'s set-up link kills that password', async () => {
    h = await setupApp()
    const ATTACKER = 'attacker chosen password'
    const attackerIp = freshIp()
    const unknown = await shape(await h.signUp('someone-new@example.com', GOOD_PASSWORD, { ip: freshIp() }))
    // Direct API sign-up with a password of the attacker's choosing.
    expect((await h.signUp('victim@example.com', ATTACKER, { ip: attackerIp })).status).toBe(200)
    // The attacker cannot sign in: the address was never confirmed.
    expect((await h.signIn('victim@example.com', ATTACKER, { ip: attackerIp })).status).toBe(403)

    // The victim signs up later: same answer as for a new address, and a "choose your password" link.
    const dup = await h.signUp('Victim@example.com', GOOD_PASSWORD, { ip: freshIp() })
    expect(await shape(dup)).toEqual(unknown)
    expect(dup.headers.getSetCookie()).toEqual([])
    await new Promise((r) => setTimeout(r, 50))
    const links = h.mail.sent.filter((m) => m.to === 'victim@example.com')
    // The attacker's own sign-up also mailed the victim a set-up link: only the mailbox owner can use either.
    expect(links).toHaveLength(2)
    for (const m of links) expect(m.subject).toBe(SETUP_SUBJECT)

    await h.setUp('victim@example.com', NEW_PASSWORD)
    expect((await users(h)).find((u) => u.email === 'victim@example.com')!.emailVerified).toBe(true)
    expect((await h.signIn('victim@example.com', ATTACKER, { ip: freshIp() })).status).toBe(401)
    expect((await h.signIn('victim@example.com', GOOD_PASSWORD, { ip: freshIp() })).status).toBe(401)
    expect((await h.signIn('victim@example.com', NEW_PASSWORD, { ip: freshIp() })).status).toBe(200)
    // The other mailed link died with the first use.
    const other = new URL(linkIn(links[0]!)).searchParams.get('token')!
    expect((await resetPassword(h, other, 'other link password')).status).toBe(400)
    expect(await users(h)).toHaveLength(2)
  })

  it('sign-ups of one address (new or duplicate) are throttled like other mail', async () => {
    const inner = createCaptureMailer()
    h = await setupApp({}, { mailer: throttled(inner) })
    await h.signUp('flood@example.com')
    for (let i = 0; i < 10; i++) expect((await h.signUp('flood@example.com', GOOD_PASSWORD, { ip: freshIp() })).status).toBe(200)
    await new Promise((r) => setTimeout(r, 50))
    expect(inner.sent.filter((m) => new URL(linkIn(m)).pathname === '/reset-password')).toHaveLength(3)
  })
})

describe('rate limits', () => {
  for (const path of ['/request-password-reset'] as const) {
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
    // Sign up and choose a password through the set-up link (a different subject, its own budget).
    await h.signUp('victim@example.com')
    await new Promise((r) => setTimeout(r, 30))
    const setupMail = inner.sent.find((m) => m.to === 'victim@example.com')!
    expect((await resetPassword(h, new URL(linkIn(setupMail)).searchParams.get('token')!)).status).toBe(200)

    const answers = new Set<string>()
    for (let i = 0; i < 50; i++) {
      const email = i % 2 ? 'victim@example.com' : 'VICTIM@example.com'
      answers.add(JSON.stringify(await shape(await requestReset(h, email))))
    }
    await new Promise((r) => setImmediate(r))
    expect(answers.size).toBe(1)
    expect(inner.sent.filter((m) => m.subject === RESET_SUBJECT)).toHaveLength(3)
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
      const lines = captureLogs()
      const seen: Mail[] = []
      const failing = make()
      h = await setupApp({}, { mailer: { send: (m) => (seen.push(m), failing.send(m)) } })

      const up = await h.signUp('fail@example.com')
      expect(up.status).toBe(200)
      expect(up.headers.getSetCookie()).toEqual([])
      await new Promise((r) => setTimeout(r, 20))
      // Verify through the database, as the link never arrived.
      await h.db.update(user).set({ emailVerified: true }).where(eq(user.email, 'fail@example.com'))
      const reset = await shape(await requestReset(h, 'fail@example.com'))
      const unknown = await shape(await requestReset(h, 'nobody@example.com'))
      expect(reset).toEqual(unknown)
      expect(reset.status).toBe(200)
      await new Promise((r) => setTimeout(r, 20))

      expect(seen).toHaveLength(2) // the set-up link, then the reset link
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
