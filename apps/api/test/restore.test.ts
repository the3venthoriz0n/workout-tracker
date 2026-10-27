// Restore from a file (spec §3, §9): POST /api/v1/import/replace `{ password, data }` replaces the
// caller's library and history in one transaction. Password checked like account deletion (same
// per-account budget), refused while a listing is published, never touches anyone else.
import { newId, type ExportData } from '@workout/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeClient, type Client } from './fixture.js'
import { GOOD_PASSWORD, cookieJar, setupApp, type Harness } from './helpers.js'

let h: Harness
beforeAll(async () => {
  h = await setupApp()
})
afterAll(async () => {
  await h?.cleanup()
})

let seq = 0
async function account(name?: string): Promise<Client> {
  const n = ++seq
  const res = await h.signUpVerified(`restore-${newId().slice(0, 8)}@example.com`, GOOD_PASSWORD, { ip: `10.248.${Math.floor(n / 250)}.${n % 250}` })
  if (res.status !== 200) throw new Error(`sign-up failed: ${res.status}`)
  const c = makeClient(h, cookieJar(res))
  await ok(c, 'POST', '/api/v1/me/init')
  if (name) await ok(c, 'PATCH', '/api/v1/me', { display_name: name })
  return c
}

async function ok(c: Client, method: string, path: string, body?: unknown): Promise<unknown> {
  const r = await c.call(method, path, body)
  if (r.status >= 300) throw new Error(`${method} ${path} -> ${r.status} ${r.text}`)
  return r.json
}

async function makePlan(c: Client, name = 'Plan') {
  const [plan, day, ex] = [newId(), newId(), newId()]
  await ok(c, 'PUT', `/api/v1/exercises/${ex}`, {
    name: `Squat ${ex.slice(0, 4)}`, notes: '', video_url: null, required_gear_ids: [], active: true,
    default_sets: 3, default_reps: 5, default_weight: 100,
  })
  await ok(c, 'PUT', `/api/v1/plans/${plan}`, { name })
  await ok(c, 'PUT', `/api/v1/days/${day}`, { plan_id: plan, name: 'Day 1' })
  await ok(c, 'POST', `/api/v1/days/${day}/items`, { exercise_id: ex })
  return { plan, day }
}

async function exportOf(c: Client): Promise<ExportData> {
  return (await ok(c, 'GET', '/api/v1/export')) as ExportData
}
async function stateOf(c: Client): Promise<string> {
  const { exported_at: _t, ...rest } = await exportOf(c)
  return JSON.stringify(rest)
}

const replace = (c: Client, data: unknown, password: unknown = GOOD_PASSWORD) =>
  c.call('POST', '/api/v1/import/replace', { password, data })

/** An export of another account with a plan in it. */
async function someFile(): Promise<ExportData> {
  const donor = await account()
  await makePlan(donor, 'From the file')
  return exportOf(donor)
}

describe('POST /api/v1/import/replace', () => {
  it('replaces the library and history, keeps the session and the public name', async () => {
    const file = await someFile()
    const u = await account('Restoring Lifter')
    await makePlan(u, 'Old plan')
    const res = await replace(u, file)
    expect(res.status, res.text).toBe(204)
    expect(res.text).toBe('')
    const after = await exportOf(u)
    expect(after.plans.map((p) => p.name)).toEqual(['From the file'])
    expect(after.profile.display_name).toBe('Restoring Lifter')
    expect(after.profile.user_id).not.toBe(file.profile.user_id)
    expect((await u.call('GET', '/api/v1/me')).status).toBe(200)
  })

  it('a wrong, missing or malformed password changes nothing', async () => {
    const file = await someFile()
    const u = await account()
    await makePlan(u, 'Mine')
    const before = await stateOf(u)
    const wrong = await replace(u, file, 'not my password at all')
    expect(wrong.status).toBe(403)
    expect(wrong.text).toBe('{"error":"invalid_password"}')
    for (const bad of ['', 123, null, 'x'.repeat(129)]) expect((await replace(u, file, bad)).status, JSON.stringify(bad)).toBe(400)
    expect((await u.call('POST', '/api/v1/import/replace', { data: file })).status).toBe(400)
    expect(await stateOf(u)).toBe(before)
  })

  it('an invalid file is 400 invalid, changes nothing and uses no password attempt', async () => {
    const file = await someFile()
    const u = await account()
    const before = await stateOf(u)
    const dangling = structuredClone(file)
    dangling.plan_days[0]!.plan_id = newId()
    for (let i = 0; i < 6; i++) {
      const r = await replace(u, i % 2 ? dangling : { hello: 'world' }, 'wrong password')
      expect(r.status).toBe(400)
      expect((r.json as { error: string }).error).toBe('invalid')
    }
    expect(await stateOf(u)).toBe(before)
    expect((await replace(u, file)).status).toBe(204)
  })

  it('shares the per-account password budget with account deletion (5 a minute)', async () => {
    const file = await someFile()
    const u = await account()
    for (let i = 0; i < 3; i++) expect((await replace(u, file, `wrong ${i}`)).status).toBe(403)
    for (let i = 0; i < 2; i++) expect((await u.call('DELETE', '/api/v1/account', { password: `wrong ${i}` })).status).toBe(403)
    const limited = await replace(u, file)
    expect(limited.status).toBe(429)
    expect(limited.json).toEqual({ error: 'rate_limited' })
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0)
  })

  it('is 409 has_published while one of the plans is published, and works after unpublishing', async () => {
    const file = await someFile()
    const u = await account('Sharer')
    const { plan } = await makePlan(u, 'Shared')
    await ok(u, 'POST', `/api/v1/plans/${plan}/publish`, { title: 'Shared plan' })
    const before = await stateOf(u)
    const res = await replace(u, file)
    expect(res.status).toBe(409)
    expect(res.text).toBe('{"error":"has_published"}')
    expect(await stateOf(u)).toBe(before)
    await ok(u, 'DELETE', `/api/v1/plans/${plan}/publish`)
    expect((await replace(u, file)).status).toBe(204)
  })

  it('needs a session, a trusted Origin and a JSON body; over 10 MB is 413', async () => {
    const u = await account()
    const before = await stateOf(u)
    const noCookie = await h.request('/api/v1/import/replace', { method: 'POST', body: { password: GOOD_PASSWORD, data: {} } })
    expect(noCookie.status).toBe(401)
    const evil = await h.request('/api/v1/import/replace', {
      method: 'POST', body: { password: GOOD_PASSWORD, data: {} }, cookie: u.cookie, origin: 'https://evil.example',
    })
    expect(evil.status).toBe(403)
    const form = await h.request('/api/v1/import/replace', {
      method: 'POST', rawBody: `password=${GOOD_PASSWORD}`, cookie: u.cookie, contentType: 'application/x-www-form-urlencoded',
    })
    expect(form.status).toBe(415)
    const big = await u.call('POST', '/api/v1/import/replace', { password: GOOD_PASSWORD, data: { pad: 'x'.repeat(10 * 1024 * 1024 + 10) } })
    expect(big.status).toBe(413)
    // 2 MB is fine here (over the 1 MB limit of other routes): it reaches validation.
    const mid = await u.call('POST', '/api/v1/import/replace', { password: GOOD_PASSWORD, data: { pad: 'x'.repeat(2 * 1024 * 1024) } })
    expect(mid.status).toBe(400)
    expect(await stateOf(u)).toBe(before)
  })
})
