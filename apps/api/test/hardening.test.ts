import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.js'
import { rateLimitIpHeaders } from '../src/auth.js'
import { account, user } from '../src/db/schema.js'
import { sanitizedLog, sanitizeError } from '../src/logging.js'
import { isTrustedOrigin } from '../src/origins.js'
import { cookieJar, setupApp, type Harness } from './helpers.js'

let h: Harness | undefined
afterEach(async () => {
  vi.restoreAllMocks()
  await h?.cleanup()
  h = undefined
})

describe('NODE_ENV fails closed', () => {
  it('vitest runs with NODE_ENV=test', () => {
    expect(process.env.NODE_ENV).toBe('test')
  })

  describe('env.ts', () => {
    const saved = { ...process.env }
    beforeEach(() => {
      vi.resetModules()
      process.env.DATABASE_URL = 'postgres://u:p@localhost:5432/d'
      process.env.BETTER_AUTH_SECRET = 'x'.repeat(40)
      process.env.BETTER_AUTH_URL = 'https://app.example.com'
    })
    afterEach(() => {
      process.env = { ...saved }
      vi.resetModules()
    })

    for (const bad of [undefined, '', 'prod', 'Production', 'staging']) {
      it(`exits when NODE_ENV is ${JSON.stringify(bad)}`, async () => {
        if (bad === undefined) delete process.env.NODE_ENV
        else process.env.NODE_ENV = bad
        const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
          throw new Error('exit called')
        }) as never)
        const err = vi.spyOn(console, 'error').mockImplementation(() => {})
        await expect(import('../src/env.js')).rejects.toThrow('exit called')
        expect(exit).toHaveBeenCalledWith(1)
        expect(JSON.stringify(err.mock.calls)).toContain('NODE_ENV')
        expect(JSON.stringify(err.mock.calls)).not.toContain('x'.repeat(40))
      })
    }

    it('loads with an explicit valid value', async () => {
      process.env.NODE_ENV = 'production'
      const { env } = await import('../src/env.js')
      expect(env.NODE_ENV).toBe('production')
    })
  })

  it('isTrustedOrigin never allows localhost or LAN origins for production or test', () => {
    for (const NODE_ENV of ['production', 'test'] as const) {
      const env = { NODE_ENV, BETTER_AUTH_URL: 'https://app.example.com', TRUSTED_ORIGINS: [] }
      for (const o of [
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'http://192.168.1.2:5173',
        'http://10.1.2.3:5173',
        'http://172.20.1.1:5173',
      ]) {
        expect(isTrustedOrigin(o, env), `${NODE_ENV} ${o}`).toBe(false)
      }
    }
  })
})

describe('rateLimitIpHeaders', () => {
  it('production reads only x-forwarded-for', () => {
    expect(rateLimitIpHeaders({ NODE_ENV: 'production' })).toEqual(['x-forwarded-for'])
  })
  it('development and test read no client-controlled header', () => {
    for (const NODE_ENV of ['development', 'test'] as const) {
      expect(rateLimitIpHeaders({ NODE_ENV })).toEqual([])
    }
  })
})

describe('Better Auth origin protection is live on its own', () => {
  it('auth.handler rejects a foreign Origin with a session cookie (bypassing csrfGuard)', async () => {
    h = await setupApp()
    const jar = cookieJar(await h.signUp('a@example.com'))
    const call = (origin: string) =>
      h!.auth.handler(
        new Request(`${h!.origin}/api/auth/sign-out`, {
          method: 'POST',
          headers: { origin, cookie: jar, 'content-type': 'application/json', 'x-test-client-ip': '203.0.113.5' },
          body: '{}',
        }),
      )
    const foreign = await call('https://evil.example')
    expect(foreign.status).toBe(403)
    // the session survived
    expect((await h.request('/api/v1/_whoami', { cookie: jar })).status).toBe(200)
    // control: the trusted origin is accepted by the same path
    expect((await call(h.origin)).status).toBe(200)
  })

  it('trustedOrigins yields only canonical origins, never a wildcard', async () => {
    h = await setupApp({ TRUSTED_ORIGINS: ['https://other.example.org/with/path'] })
    const fn = h.auth.options.trustedOrigins as (r?: Request) => Promise<(string | undefined | null)[]> | (string | undefined | null)[]
    expect(typeof fn).toBe('function')
    for (const origin of [h.origin, 'https://evil.example', 'https://*.example.com', 'http://localhost:*', 'null', undefined]) {
      const req = new Request(`${h.origin}/api/auth/ok`, { headers: origin ? { origin } : {} })
      const list = (await fn(req)) as string[]
      for (const o of list) {
        expect(o).toBe(new URL(o).origin)
        expect(o).not.toMatch(/[*?]/)
      }
      expect(list).toContain(h.origin)
      expect(list).toContain('https://other.example.org')
      expect(list).not.toContain('https://evil.example')
    }
    expect(await fn(undefined)).toEqual([h.origin, 'https://other.example.org'])
  })
})

describe('logs carry no secrets', () => {
  const HASH = 'FAKE-PASSWORD-HASH-8f3a91c2'
  const TOKEN = 'FAKE-SESSION-TOKEN-77d0e5b4'

  async function uniqueViolation(hh: Harness): Promise<unknown> {
    await hh.db.insert(user).values({ id: 'u1', name: 'n', email: 'dup@example.com' })
    const row = {
      id: 'acc1',
      accountId: 'u1',
      providerId: 'credential',
      userId: 'u1',
      password: HASH,
      accessToken: TOKEN,
    }
    await hh.db.insert(account).values(row)
    try {
      await hh.db.insert(account).values(row)
    } catch (e) {
      return e
    }
    throw new Error('expected a unique violation')
  }

  function captured(): string {
    return JSON.stringify(
      [console.error, console.warn, console.log].flatMap((f) => (vi.isMockFunction(f) ? f.mock.calls : [])),
    )
  }

  it('the raw Drizzle error does contain the secrets (precondition)', async () => {
    h = await setupApp()
    const err = (await uniqueViolation(h)) as Error
    expect(`${err.message}`).toContain(HASH)
  })

  it('sanitizeError strips params and cause but keeps name and code', async () => {
    h = await setupApp()
    const safe = sanitizeError(await uniqueViolation(h))
    expect(JSON.stringify(safe)).not.toContain(HASH)
    expect(JSON.stringify(safe)).not.toContain(TOKEN)
    expect(safe.name).toBe('DrizzleQueryError')
    expect(safe.code).toBe('23505')
    expect(safe).not.toHaveProperty('cause')
  })

  it('the app error handler logs the sanitized error only', async () => {
    h = await setupApp()
    const err = await uniqueViolation(h)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const app = createApp({
      auth: {
        handler: async () => {
          throw err
        },
      } as never,
      env: h.env,
      getService: () => {
        throw new Error('unused')
      },
    })
    const res = await app.request('/api/auth/ok')
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'internal_error' })
    const out = captured()
    expect(out).not.toContain(HASH)
    expect(out).not.toContain(TOKEN)
    expect(out).toContain('DrizzleQueryError')
    expect(out).toContain('23505')
  })

  it("Better Auth's logger output is sanitized too", async () => {
    h = await setupApp()
    const err = await uniqueViolation(h)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    sanitizedLog('error', `# SERVER_ERROR: Failed query: insert\nparams: ${HASH},${TOKEN}`, err, { cause: err, token: TOKEN })
    sanitizedLog('warn', 'Invalid password')
    const out = captured()
    expect(out).not.toContain(HASH)
    expect(out).not.toContain(TOKEN)
    expect(out).toContain('DrizzleQueryError')
    expect(out).toContain('Invalid password')
  })

  it('the configured auth instance uses the sanitizer', async () => {
    h = await setupApp()
    expect(h.auth.options.logger?.log).toBe(sanitizedLog)
  })
})
