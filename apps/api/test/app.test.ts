import { describe, expect, it } from 'vitest'

// No DB needed: the client connects lazily and these routes don't query.
process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test'
const { app } = await import('../src/app.js')

describe('app', () => {
  it('returns JSON 404 for unknown API routes', async () => {
    const res = await app.request('/api/v1/nope')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not_found' })
  })

  it('sets security headers', async () => {
    const res = await app.request('/api/v1/nope')
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'")
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('strict-transport-security')).toBe('max-age=15552000')
  })
})
