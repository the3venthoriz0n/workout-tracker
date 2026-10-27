import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// env.ts parses process.env at import time and exits on error, so each case re-imports it.
describe('env.ts optional settings', () => {
  const saved = { ...process.env }
  beforeEach(() => {
    vi.resetModules()
    process.env.NODE_ENV = 'production'
    process.env.DATABASE_URL = 'postgres://u:p@localhost:5432/d'
    process.env.BETTER_AUTH_SECRET = 'x'.repeat(40)
    process.env.BETTER_AUTH_URL = 'https://app.example.com'
    process.env.RESEND_API_KEY = 'test-resend-key-123'
    process.env.MAIL_FROM = 'Workout Tracker <no-reply@example.invalid>'
    delete process.env.CLIENT_IP_HEADER
    delete process.env.SIGNUP_ALLOWLIST
  })
  afterEach(() => {
    vi.restoreAllMocks()
    process.env = { ...saved }
    vi.resetModules()
  })

  async function rejects(name: string) {
    vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit called')
    }) as never)
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(import('../src/env.js')).rejects.toThrow('exit called')
    expect(JSON.stringify(err.mock.calls)).toContain(name)
    return JSON.stringify(err.mock.calls)
  }

  describe('CLIENT_IP_HEADER', () => {
    it('is undefined when unset or empty', async () => {
      expect((await import('../src/env.js')).env.CLIENT_IP_HEADER).toBeUndefined()
      vi.resetModules()
      process.env.CLIENT_IP_HEADER = ''
      expect((await import('../src/env.js')).env.CLIENT_IP_HEADER).toBeUndefined()
    })
    it('accepts a lowercase header token', async () => {
      process.env.CLIENT_IP_HEADER = 'cf-connecting-ip'
      expect((await import('../src/env.js')).env.CLIENT_IP_HEADER).toBe('cf-connecting-ip')
    })
    for (const bad of ['CF-Connecting-IP', 'x forwarded', 'a:b', 'a,b', '-lead', 'under_score', 'x-ip\n']) {
      it(`rejects ${JSON.stringify(bad)}`, async () => {
        process.env.CLIENT_IP_HEADER = bad
        await rejects('CLIENT_IP_HEADER')
      })
    }
  })

  describe('SIGNUP_ALLOWLIST', () => {
    it('is an empty list when unset, empty or only commas/spaces', async () => {
      expect((await import('../src/env.js')).env.SIGNUP_ALLOWLIST).toEqual([])
      for (const v of ['', ' , ,']) {
        vi.resetModules()
        process.env.SIGNUP_ALLOWLIST = v
        expect((await import('../src/env.js')).env.SIGNUP_ALLOWLIST).toEqual([])
      }
    })
    it('trims, lowercases and drops empty entries', async () => {
      process.env.SIGNUP_ALLOWLIST = ' Alice@Example.com, ,bob@example.org,'
      expect((await import('../src/env.js')).env.SIGNUP_ALLOWLIST).toEqual(['alice@example.com', 'bob@example.org'])
    })
    for (const bad of ['not-an-email', 'a@example.com,oops', '@example.com', 'a b@example.com']) {
      it(`rejects ${JSON.stringify(bad)} without echoing it`, async () => {
        process.env.SIGNUP_ALLOWLIST = bad
        const out = await rejects('SIGNUP_ALLOWLIST')
        expect(out).not.toContain(bad)
      })
    }
  })

  describe('RESEND_API_KEY and MAIL_FROM', () => {
    it('are read in production', async () => {
      const { env } = await import('../src/env.js')
      expect(env.RESEND_API_KEY).toBe('test-resend-key-123')
      expect(env.MAIL_FROM).toBe('Workout Tracker <no-reply@example.invalid>')
    })
    for (const name of ['RESEND_API_KEY', 'MAIL_FROM'] as const) {
      for (const value of [undefined, '']) {
        it(`production exits when ${name} is ${value === undefined ? 'unset' : 'empty'}, without echoing the other`, async () => {
          if (value === undefined) delete process.env[name]
          else process.env[name] = value
          const out = await rejects(name)
          expect(out).not.toContain('test-resend-key-123')
        })
      }
    }
    for (const NODE_ENV of ['development', 'test']) {
      it(`${NODE_ENV} loads without them`, async () => {
        process.env.NODE_ENV = NODE_ENV
        delete process.env.RESEND_API_KEY
        delete process.env.MAIL_FROM
        const { env } = await import('../src/env.js')
        expect(env.RESEND_API_KEY).toBeUndefined()
        expect(env.MAIL_FROM).toBeUndefined()
      })
    }
    it('accepts a bare address as MAIL_FROM', async () => {
      process.env.MAIL_FROM = 'no-reply@example.invalid'
      expect((await import('../src/env.js')).env.MAIL_FROM).toBe('no-reply@example.invalid')
    })
    for (const bad of ['not an address', 'Name <no-reply@example.invalid>\r\nBcc: x@example.invalid', 'a@example.invalid, b@example.invalid']) {
      it(`rejects MAIL_FROM ${JSON.stringify(bad)}`, async () => {
        process.env.MAIL_FROM = bad
        await rejects('MAIL_FROM')
      })
    }
    it('rejects a RESEND_API_KEY with whitespace, without echoing it', async () => {
      process.env.RESEND_API_KEY = 'abc def-key-value'
      const out = await rejects('RESEND_API_KEY')
      expect(out).not.toContain('abc def-key-value')
    })
  })
})
