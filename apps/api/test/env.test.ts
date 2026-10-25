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
    for (const bad of ['not-an-email', 'a@b.co,oops', '@example.com', 'a b@example.com']) {
      it(`rejects ${JSON.stringify(bad)} without echoing it`, async () => {
        process.env.SIGNUP_ALLOWLIST = bad
        const out = await rejects('SIGNUP_ALLOWLIST')
        expect(out).not.toContain(bad)
      })
    }
  })
})
