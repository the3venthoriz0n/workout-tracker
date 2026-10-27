import { afterEach, describe, expect, it } from 'vitest'
import { cookieJar, GOOD_PASSWORD, setupApp, type Harness } from './helpers.js'

let h: Harness
afterEach(async () => {
  await h?.cleanup()
})

function sessionCookieAttrs(res: Response): string[] {
  const line = res.headers.getSetCookie().find((c) => /session_token=[^;]+/.test(c) && !/session_token=;/.test(c))
  expect(line, 'session Set-Cookie').toBeDefined()
  return line!.split(';').map((p) => p.trim().toLowerCase())
}

describe('sign up', () => {
  it('creates the account without a session; after verifying, sign-in sets an HttpOnly, SameSite=Lax cookie (not Secure outside production)', async () => {
    h = await setupApp()
    const up = await h.signUp('Alice@Example.com')
    expect(up.status).toBe(200)
    expect(up.headers.getSetCookie()).toEqual([])
    expect(((await up.json()) as { user: { email: string } }).user.email).toBe('alice@example.com')
    const res = await h.signUpVerified('Bob@Example.com')
    expect(res.status).toBe(200)
    const attrs = sessionCookieAttrs(res)
    expect(attrs).toContain('httponly')
    expect(attrs).toContain('samesite=lax')
    expect(attrs).toContain('path=/')
    expect(attrs).not.toContain('secure')
    expect(attrs.some((a) => a.startsWith('max-age=')) && attrs.find((a) => a.startsWith('max-age='))).toBe(
      `max-age=${60 * 60 * 24 * 30}`,
    )
    const body = (await res.json()) as { user: { email: string } }
    expect(body.user.email).toBe('bob@example.com')

    const who = await h.request('/api/v1/progression', { cookie: cookieJar(res) })
    expect(who.status).toBe(200)
  })

  it('sets the Secure attribute in production', async () => {
    h = await setupApp({ NODE_ENV: 'production' })
    const res = await h.signUpVerified('alice@example.com')
    expect(res.status).toBe(200)
    const attrs = sessionCookieAttrs(res)
    expect(attrs).toContain('secure')
    expect(attrs).toContain('httponly')
    expect(attrs).toContain('samesite=lax')
    expect(res.headers.getSetCookie().some((c) => c.startsWith('__Secure-'))).toBe(true)
    const who = await h.request('/api/v1/progression', { cookie: cookieJar(res) })
    expect(who.status).toBe(200)
  })

  it('enforces password length 10..128', async () => {
    h = await setupApp()
    const results: Record<number, number> = {}
    for (const len of [9, 10, 128, 129]) {
      const res = await h.signUp(`len${len}@example.com`, 'x'.repeat(len))
      results[len] = res.status
    }
    expect(results[9]).toBe(400)
    expect(results[129]).toBe(400)
    expect(results[10]).toBe(200)
    expect(results[128]).toBe(200)
    // a short password creates no user and no session
    const again = await h.signIn('len9@example.com', 'x'.repeat(9))
    expect(again.status).toBe(401)
  })

  it('rejects an invalid email', async () => {
    h = await setupApp()
    for (const email of ['not-an-email', 'a@', '@b.co', '', 'a b@example.com']) {
      const res = await h.signUp(email)
      expect(res.status, email).toBeGreaterThanOrEqual(400)
      expect(res.status, email).toBeLessThan(500)
      expect(res.headers.getSetCookie().length).toBe(0)
    }
  })

  it('a duplicate sign-up (any letter case) looks like a new one, creates nothing and keeps the first password', async () => {
    h = await setupApp()
    expect((await h.signUpVerified('dup@example.com')).status).toBe(200)
    const second = await h.signUp('DUP@example.com', 'another password!')
    expect(second.status).toBe(200)
    expect(second.headers.getSetCookie().length).toBe(0)
    const { user } = await import('../src/db/schema.js')
    expect(await h.db.select().from(user)).toHaveLength(1)
    expect((await h.signIn('dup@example.com', GOOD_PASSWORD, { ip: '203.0.113.60' })).status).toBe(200)
    expect((await h.signIn('dup@example.com', 'another password!')).status).toBe(401)
  })

  it('never stores the password in clear text', async () => {
    h = await setupApp()
    await h.signUp('hash@example.com')
    const { account } = await import('../src/db/schema.js')
    const rows = await h.db.select({ password: account.password }).from(account)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.password).toBeTruthy()
    expect(rows[0]!.password).not.toContain(GOOD_PASSWORD)
  })
})

describe('sign-up allowlist', () => {
  const allow = ['alice@example.com', 'bob@example.org']

  async function counts(db: Harness['db']) {
    const { user, session } = await import('../src/db/schema.js')
    return { users: (await db.select().from(user)).length, sessions: (await db.select().from(session)).length }
  }

  it('lets a listed email sign up, in any letter case, and sign in', async () => {
    h = await setupApp({ SIGNUP_ALLOWLIST: allow })
    const up = await h.signUp('ALICE@Example.COM')
    expect(up.status).toBe(200)
    expect(h.mail.sent.map((m) => m.to)).toEqual(['alice@example.com'])
    await h.verify('alice@example.com')
    expect((await h.signIn('alice@example.com', GOOD_PASSWORD)).status).toBe(200)
  })

  it('refuses an unlisted email with a uniform 403 signup_closed and creates no user or session', async () => {
    h = await setupApp({ SIGNUP_ALLOWLIST: allow })
    const res = await h.signUp('mallory@example.com')
    expect(res.status).toBe(403)
    expect(res.headers.getSetCookie().length).toBe(0)
    expect(await res.json()).toEqual({ code: 'SIGNUP_CLOSED', message: 'signup_closed' })
    expect(await counts(h.db)).toEqual({ users: 0, sessions: 0 })
    expect(h.mail.sent).toEqual([])
    expect((await h.signIn('mallory@example.com', GOOD_PASSWORD)).status).toBe(401)
  })

  it('matches exactly after lowercasing: plus-addressing and lookalikes are refused', async () => {
    h = await setupApp({ SIGNUP_ALLOWLIST: allow })
    for (const email of [
      'alice+x@example.com',
      'alice@example.com.evil.example',
      'a.lice@example.com',
      'alice@example.org',
      'xalice@example.com',
    ]) {
      const res = await h.signUp(email)
      expect(res.status, email).toBe(403)
      expect(res.headers.getSetCookie().length, email).toBe(0)
    }
    expect(await counts(h.db)).toEqual({ users: 0, sessions: 0 })
  })

  it('answers a blocked email the same way every time', async () => {
    h = await setupApp({ SIGNUP_ALLOWLIST: allow })
    const a = await h.signUp('mallory@example.com')
    const b = await h.signUp('mallory@example.com')
    expect(b.status).toBe(a.status)
    expect(await b.json()).toEqual(await a.json())
  })

  it('does not affect sign-in of accounts that already exist', async () => {
    h = await setupApp()
    expect((await h.signUpVerified('legacy@example.com')).status).toBe(200)
    const { createAuth } = await import('../src/auth.js')
    const { createApp } = await import('../src/app.js')
    const env = { ...h.env, SIGNUP_ALLOWLIST: allow }
    const auth = createAuth(h.db, env, { mailer: h.mail, clientIpHeader: 'x-test-client-ip' })
    const app = createApp({
      auth,
      env,
      getService: () => {
        throw new Error('unused')
      },
      getPublic: () => {
        throw new Error('unused')
      },
    })
    const res = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { origin: h.origin, 'content-type': 'application/json', 'x-test-client-ip': '203.0.113.50' },
      body: JSON.stringify({ email: 'legacy@example.com', password: GOOD_PASSWORD }),
    })
    expect(res.status).toBe(200)
  })

  it('an empty allowlist keeps sign-up open', async () => {
    h = await setupApp({ SIGNUP_ALLOWLIST: [] })
    expect((await h.signUp('anyone@example.com')).status).toBe(200)
  })
})

describe('sign in and out', () => {
  it('a wrong password and an unknown email give the same generic failure', async () => {
    h = await setupApp()
    await h.signUpVerified('real@example.com')
    const wrong = await h.signIn('real@example.com', 'wrong password!')
    const unknown = await h.signIn('nobody@example.com', 'wrong password!')
    expect(wrong.status).toBe(401)
    expect(unknown.status).toBe(wrong.status)
    expect(await unknown.json()).toEqual(await wrong.json())
    expect(wrong.headers.getSetCookie().length).toBe(0)
    expect(unknown.headers.getSetCookie().length).toBe(0)
    const text = JSON.stringify(await (await h.signIn('nobody@example.com', 'x')).json()).toLowerCase()
    expect(text).not.toMatch(/not found|no user|unknown|exist/)
  })

  it('signs in with the right password and the new cookie works', async () => {
    h = await setupApp()
    await h.signUpVerified('real@example.com')
    const res = await h.signIn('real@example.com', GOOD_PASSWORD)
    expect(res.status).toBe(200)
    expect((await h.request('/api/v1/progression', { cookie: cookieJar(res) })).status).toBe(200)
  })

  it('sign out invalidates the cookie server-side, even if the client keeps it', async () => {
    h = await setupApp()
    const up = await h.signUpVerified('real@example.com')
    const jar = cookieJar(up)
    expect((await h.request('/api/v1/progression', { cookie: jar })).status).toBe(200)
    const out = await h.request('/api/auth/sign-out', { method: 'POST', body: {}, cookie: jar })
    expect(out.status).toBe(200)
    const after = await h.request('/api/v1/progression', { cookie: jar })
    expect(after.status).toBe(401)
    expect(await after.json()).toEqual({ error: 'unauthorized' })
  })

  it('sign-in with a foreign Origin is refused and sets no cookie', async () => {
    h = await setupApp()
    await h.signUpVerified('real@example.com')
    const res = await h.signIn('real@example.com', GOOD_PASSWORD, { origin: 'https://evil.example' })
    expect(res.status).toBe(403)
    expect(res.headers.getSetCookie().length).toBe(0)
  })
})

describe('rate limiting', () => {
  it('returns 429 after 5 failed sign-ins in a minute, even for the right password afterwards', async () => {
    h = await setupApp()
    await h.signUpVerified('real@example.com')
    const statuses: number[] = []
    for (let i = 0; i < 6; i++) statuses.push((await h.signIn('real@example.com', `wrong password ${i}`)).status)
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401])
    expect(statuses[5]).toBe(429)
    const locked = await h.signIn('real@example.com', GOOD_PASSWORD)
    expect(locked.status).toBe(429)
    expect(locked.headers.getSetCookie().length).toBe(0)
  })

  it('limits per client IP: another IP is not affected', async () => {
    h = await setupApp()
    await h.signUpVerified('real@example.com')
    for (let i = 0; i < 6; i++) await h.signIn('real@example.com', `wrong password ${i}`)
    expect((await h.signIn('real@example.com', GOOD_PASSWORD)).status).toBe(429)
    expect((await h.signIn('real@example.com', GOOD_PASSWORD, { ip: '203.0.113.77' })).status).toBe(200)
  })

  it('limits sign-up to 10 per hour per IP', async () => {
    h = await setupApp()
    const statuses: number[] = []
    for (let i = 0; i < 11; i++) statuses.push((await h.signUp(`u${i}@example.com`)).status)
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true)
    expect(statuses[10]).toBe(429)
  })

  it('does not trust X-Forwarded-For outside production (cannot be used to dodge the limit)', async () => {
    h = await setupApp()
    await h.signUpVerified('real@example.com')
    // In this harness the client-IP header is x-test-client-ip, never XFF.
    const statuses: number[] = []
    for (let i = 0; i < 6; i++) {
      const res = await h.app.request('/api/auth/sign-in/email', {
        method: 'POST',
        headers: {
          origin: h.origin,
          'content-type': 'application/json',
          'x-test-client-ip': '198.51.100.9',
          'x-forwarded-for': `203.0.113.${i + 1}`,
        },
        body: JSON.stringify({ email: 'real@example.com', password: `wrong password ${i}` }),
      })
      statuses.push(res.status)
    }
    expect(statuses[5]).toBe(429)
  })
})
