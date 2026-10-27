import { newId, type ExportData } from '@workout/shared'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.js'
import { ROUTES } from '../src/routes/table.js'
import { createService } from '../src/service/index.js'
import { buildFixture, fill, randomFixture, signUpClient, type Client } from './fixture.js'
import { cookieJar, setupApp, type Harness } from './helpers.js'

let h: Harness
let u: Client
beforeAll(async () => {
  h = await setupApp()
  u = await signUpClient(h, 'routes@example.com')
})
afterAll(async () => {
  await h?.cleanup()
})

const label = (r: { method: string; path: string }) => `${r.method} ${r.path}`

describe('happy path for every route in the table', () => {
  it.each(ROUTES.map((r) => [label(r), r] as const))('%s', async (_name, spec) => {
    // Import is first-time only, so it runs as a brand-new account that has never been initialised.
    // Deleting the account runs as a throwaway account too, so `u` survives for the other cases.
    const client = spec.freshAccount || spec.deletesAccount ? await signUpClient(h, `fresh-${newId()}@example.com`) : u
    const f = await buildFixture(u, { active: spec.noActiveSession ? false : true })
    const res = await client.call(spec.method, fill(spec, f), spec.body?.(f))
    expect(res.status, res.text).toBe(spec.status)
    if (spec.status === 204) {
      expect(res.text).toBe('')
    } else {
      expect(res.headers.get('content-type')).toContain('application/json')
      expect(spec.response, 'every JSON route declares a response schema').toBeDefined()
      const parsed = spec.response!.safeParse(res.json)
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true)
    }
    if (spec.freshAccount) {
      // The upload landed under the new account, not under the exporter's.
      const mine = (await client.call('GET', '/api/v1/export')).json as ExportData
      expect(mine.profile.user_id).not.toBe(f.export.profile.user_id)
      expect(mine.exercises.map((e) => e.id).sort()).toEqual(f.export.exercises.map((e) => e.id).sort())
    }
  })
})

describe('status codes and idempotency', () => {
  it('PUT is an idempotent upsert (200 twice, one row, created_at kept)', async () => {
    await u.call('POST', '/api/v1/me/init')
    const gearId = newId()
    const body = { name: 'Kettlebell', owned: true }
    const a = await u.call('PUT', `/api/v1/gear/${gearId}`, body)
    const b = await u.call('PUT', `/api/v1/gear/${gearId}`, { ...body, owned: false })
    expect([a.status, b.status]).toEqual([200, 200])
    const [ga, gb] = [a.json, b.json] as { id: string; created_at: string; owned: boolean }[]
    expect(gb!.id).toBe(ga!.id)
    expect(gb!.created_at).toBe(ga!.created_at)
    expect(gb!.owned).toBe(false)
    const list = (await u.call('GET', '/api/v1/gear')).json as { id: string }[]
    expect(list.filter((g) => g.id === gearId)).toHaveLength(1)

    const f = await buildFixture(u)
    for (const [path, payload] of [
      [`/api/v1/plans/${f.plan}`, { name: 'Same' }],
      [`/api/v1/days/${f.day}`, { plan_id: f.plan, name: 'Same' }],
    ] as const) {
      expect((await u.call('PUT', path, payload)).status).toBe(200)
      expect((await u.call('PUT', path, payload)).status).toBe(200)
    }
  })

  it('POST item with a client id is idempotent (201, same item, one row)', async () => {
    const f = await buildFixture(u)
    const id = newId()
    const a = await u.call('POST', `/api/v1/days/${f.day}/items`, { exercise_id: f.exercise, id })
    const b = await u.call('POST', `/api/v1/days/${f.day}/items`, { exercise_id: f.exercise, id })
    expect([a.status, b.status]).toEqual([201, 201])
    expect((a.json as { id: string }).id).toBe(id)
    const tree = (await u.call('GET', `/api/v1/plans/${f.plan}`)).json as { days: { items: { id: string }[] }[] }
    expect(tree.days[0]!.items.filter((i) => i.id === id)).toHaveLength(1)
    // The same id for a different exercise is a conflict, not a silent overwrite.
    const other = newId()
    await u.call('PUT', `/api/v1/exercises/${other}`, {
      name: 'Row', notes: '', video_url: null, required_gear_ids: [], active: true,
      default_sets: 3, default_reps: 5, default_weight: 50,
    })
    const c = await u.call('POST', `/api/v1/days/${f.day}/items`, { exercise_id: other, id })
    expect(c.status).toBe(409)
    expect(c.json).toEqual({ error: 'conflict' })
  })

  it('a second session start is 409 session_in_progress', async () => {
    const f = await buildFixture(u) // leaves one active
    const res = await u.call('POST', '/api/v1/sessions', { plan_day_id: f.day })
    expect(res.status).toBe(409)
    expect(res.json).toEqual({ error: 'session_in_progress' })
  })

  it('finishing or discarding a completed session is 409 conflict', async () => {
    const f = await buildFixture(u)
    for (const [method, path] of [
      ['POST', `/api/v1/sessions/${f.completedSession}/complete`],
      ['DELETE', `/api/v1/sessions/${f.completedSession}`],
    ] as const) {
      const res = await u.call(method, path)
      expect(res.status, path).toBe(409)
      expect(res.json).toEqual({ error: 'conflict' })
    }
  })

  it('GET /sessions/active is 200 with JSON null when there is none', async () => {
    const f = await buildFixture(u, { active: false })
    expect(f.session).toBe(f.completedSession)
    const res = await u.call('GET', '/api/v1/sessions/active')
    expect(res.status).toBe(200)
    expect(res.text).toBe('null')
  })

  it('import into an account that already has a profile is 409 already_has_data', async () => {
    const f = await buildFixture(u)
    const res = await u.call('POST', '/api/v1/import', f.export)
    expect(res.status).toBe(409)
    expect(res.json).toEqual({ error: 'already_has_data' })
  })

  it('export and /me before the account is initialised are 404 not_found', async () => {
    const fresh = await signUpClient(h, `noprofile-${newId()}@example.com`)
    for (const path of ['/api/v1/export', '/api/v1/me']) {
      const res = await fresh.call('GET', path)
      expect(res.status, path).toBe(404)
      expect(res.json).toEqual({ error: 'not_found' })
    }
  })

  it('the temporary _whoami probe is gone', async () => {
    const res = await u.call('GET', '/api/v1/_whoami')
    expect(res.status).toBe(404)
  })
})

describe('validation: 400 invalid with issues, never a 500, never an echo', () => {
  const exercise = (over: Record<string, unknown>) => ({
    name: 'Squat', notes: '', video_url: null, required_gear_ids: [], active: true,
    default_sets: 3, default_reps: 5, default_weight: 95, ...over,
  })
  const rule = (over: Record<string, unknown>) => ({
    rule: { success_action: 'add_weight', success_amount: 5, fail_streak_limit: 3, deload_pct: 10, rep_ceiling: null, ...over },
  })
  const id = newId()
  const cases: [string, string, string, unknown, string][] = [
    ['gear name too long', 'PUT', `/api/v1/gear/${id}`, { name: 'x'.repeat(201), owned: true }, 'name'],
    ['gear name empty', 'PUT', `/api/v1/gear/${id}`, { name: '', owned: true }, 'name'],
    ['gear missing owned', 'PUT', `/api/v1/gear/${id}`, { name: 'x' }, 'owned'],
    ['gear wrong type', 'PUT', `/api/v1/gear/${id}`, { name: 5, owned: 'yes' }, 'name'],
    ['exercise weight over bound', 'PUT', `/api/v1/exercises/${id}`, exercise({ default_weight: 100001 }), 'default_weight'],
    ['exercise weight huge', 'PUT', `/api/v1/exercises/${id}`, exercise({ default_weight: 1e12 }), 'default_weight'],
    ['exercise weight negative', 'PUT', `/api/v1/exercises/${id}`, exercise({ default_weight: -1 }), 'default_weight'],
    ['exercise sets over bound', 'PUT', `/api/v1/exercises/${id}`, exercise({ default_sets: 101 }), 'default_sets'],
    ['exercise reps over bound', 'PUT', `/api/v1/exercises/${id}`, exercise({ default_reps: 1001 }), 'default_reps'],
    ['exercise notes too long', 'PUT', `/api/v1/exercises/${id}`, exercise({ notes: 'x'.repeat(5001) }), 'notes'],
    ['exercise url too long', 'PUT', `/api/v1/exercises/${id}`, exercise({ video_url: `https://e.co/${'a'.repeat(2000)}` }), 'video_url'],
    ['exercise javascript url', 'PUT', `/api/v1/exercises/${id}`, exercise({ video_url: 'javascript:alert(1)' }), 'video_url'],
    ['exercise gear id not a uuid', 'PUT', `/api/v1/exercises/${id}`, exercise({ required_gear_ids: ['nope'] }), 'required_gear_ids.0'],
    ['plan name too long', 'PUT', `/api/v1/plans/${id}`, { name: 'x'.repeat(201) }, 'name'],
    ['day plan_id not a uuid', 'PUT', `/api/v1/days/${id}`, { plan_id: 'abc', name: 'D' }, 'plan_id'],
    ['item exercise_id missing', 'POST', `/api/v1/days/${id}/items`, {}, 'exercise_id'],
    ['item body id not a uuid', 'POST', `/api/v1/days/${id}/items`, { exercise_id: id, id: 'zzz' }, 'id'],
    ['item sets over bound', 'PATCH', `/api/v1/items/${id}`, { sets: 101 }, 'sets'],
    ['item weight over bound', 'PATCH', `/api/v1/items/${id}`, { weight: 1e9 }, 'weight'],
    ['rule amount over bound', 'PUT', `/api/v1/items/${id}/rule`, rule({ success_amount: 100001 }), 'rule.success_amount'],
    ['rule streak over bound', 'PUT', `/api/v1/items/${id}/rule`, rule({ fail_streak_limit: 1001 }), 'rule.fail_streak_limit'],
    ['rule missing key', 'PUT', `/api/v1/items/${id}/rule`, {}, 'rule'],
    ['move bad direction', 'POST', '/api/v1/move', { kind: 'item', id, direction: 2 }, 'direction'],
    ['move bad kind', 'POST', '/api/v1/move', { kind: 'plan', id, direction: 1 }, 'kind'],
    ['move id not a uuid', 'POST', '/api/v1/move', { kind: 'day', id: '1', direction: 1 }, 'id'],
    ['session start missing day', 'POST', '/api/v1/sessions', {}, 'plan_day_id'],
    ['session note too long', 'PATCH', `/api/v1/sessions/${id}`, { note: 'x'.repeat(5001) }, 'note'],
    ['set weight over bound', 'PATCH', `/api/v1/sets/${id}`, { weight: 1000000 }, 'weight'],
    ['set reps over bound', 'PATCH', `/api/v1/sets/${id}`, { actual_reps: 1001 }, 'actual_reps'],
    ['set updated_at garbage', 'PATCH', `/api/v1/sets/${id}`, { updated_at: 'yesterday' }, 'updated_at'],
    ['set updated_at impossible date', 'PATCH', `/api/v1/sets/${id}`, { updated_at: '2026-02-31T25:00:00Z' }, 'updated_at'],
    ['profile units', 'PATCH', '/api/v1/me', { units: 'stone' }, 'units'],
    ['profile increment zero', 'PATCH', '/api/v1/me', { weight_increment: 0 }, 'weight_increment'],
    ['import is not an export', 'POST', '/api/v1/import', {}, 'version'],
    ['day colour not in the palette', 'PUT', `/api/v1/days/${id}`, { plan_id: id, name: 'D', color: 'mauve' }, 'color'],
    ['item angle not an angle', 'PATCH', `/api/v1/items/${id}`, { angle: 'sideways' }, 'angle'],
    ['item amrap_last not a boolean', 'PATCH', `/api/v1/items/${id}`, { amrap_last: 'yes' }, 'amrap_last'],
    ['exercise supports_angle not a boolean', 'PUT', `/api/v1/exercises/${id}`, exercise({ supports_angle: 1 }), 'supports_angle'],
    ['exercise rule amount over bound', 'PUT', `/api/v1/exercises/${id}/rule`, rule({ success_amount: 100001 }), 'rule.success_amount'],
    ['exercise rule missing key', 'PUT', `/api/v1/exercises/${id}/rule`, {}, 'rule'],
    ['superset with one item', 'PUT', `/api/v1/days/${id}/supersets/${newId()}`, { item_ids: [id] }, 'item_ids'],
    ['superset with four items', 'PUT', `/api/v1/days/${id}/supersets/${newId()}`, { item_ids: [newId(), newId(), newId(), newId()] }, 'item_ids'],
    ['superset item id not a uuid', 'PUT', `/api/v1/days/${id}/supersets/${newId()}`, { item_ids: [id, 'nope'] }, 'item_ids.1'],
    ['superset missing item_ids', 'PUT', `/api/v1/days/${id}/supersets/${newId()}`, {}, 'item_ids'],
  ]
  it.each(cases)('%s', async (_n, method, path, payload, issuePath) => {
    const res = await u.call(method, path, payload)
    expect(res.status, res.text).toBe(400)
    const j = res.json as { error: string; issues: { path: string; message: string }[] }
    expect(j.error).toBe('invalid')
    expect(j.issues.length).toBeGreaterThan(0)
    expect(j.issues.map((i) => i.path)).toContain(issuePath)
    for (const i of j.issues) expect(Object.keys(i).sort()).toEqual(['message', 'path'])
  })

  it('rule checks that need stored data are 400 invalid too (angle support, superset day and duplicates)', async () => {
    const f = await buildFixture(u, { active: false })
    const plain = newId()
    await u.call('PUT', `/api/v1/exercises/${plain}`, exercise({}))
    const item = (await u.call('POST', `/api/v1/days/${f.day}/items`, { exercise_id: plain })).json as { id: string }
    const day2 = newId()
    await u.call('PUT', `/api/v1/days/${day2}`, { plan_id: f.plan, name: 'Other' })
    const before = (await u.call('GET', '/api/v1/export')).json as ExportData
    const cases: [string, string, unknown, string][] = [
      ['PATCH', `/api/v1/items/${item.id}`, { angle: 'incline' }, 'angle'],
      ['PUT', `/api/v1/days/${day2}/supersets/${newId()}`, { item_ids: [f.item, f.item2] }, 'item_ids'],
      ['PUT', `/api/v1/days/${f.day}/supersets/${newId()}`, { item_ids: [f.item, f.item] }, 'item_ids'],
    ]
    for (const [method, path, payload, issuePath] of cases) {
      const res = await u.call(method, path, payload)
      expect(res.status, `${method} ${path} ${res.text}`).toBe(400)
      const j = res.json as { error: string; issues: { path: string }[] }
      expect(j.error).toBe('invalid')
      expect(j.issues.map((i) => i.path)).toContain(issuePath)
    }
    const after = (await u.call('GET', '/api/v1/export')).json as ExportData
    expect(after.plan_items).toEqual(before.plan_items)
  })

  it('does not echo submitted values back', async () => {
    const res = await u.call('PUT', `/api/v1/gear/${newId()}`, { name: `SECRETVALUE${'x'.repeat(300)}`, owned: 'SECRETFLAG' })
    expect(res.status).toBe(400)
    expect(res.text).not.toContain('SECRET')
  })

  it('malformed JSON, null and arrays are 400 invalid', async () => {
    for (const rawBody of ['{bad', 'null', '[]', '"s"', '']) {
      const res = await h.request(`/api/v1/gear/${newId()}`, { method: 'PUT', rawBody, cookie: u.cookie })
      expect(res.status, rawBody).toBe(400)
      expect(((await res.json()) as { error: string }).error).toBe('invalid')
    }
  })

  it('a malformed UUID in any path is 400 invalid with the param named, for every route with params', async () => {
    for (const spec of ROUTES.filter((r) => r.params)) {
      const path = spec.path.replace(/:(\w+)/g, 'not-a-uuid')
      const f = randomFixture((await buildFixture(u)))
      const res = await u.call(spec.method, path, spec.body?.(f))
      expect(res.status, `${spec.method} ${path}`).toBe(400)
      const j = res.json as { error: string; issues: { path: string }[] }
      expect(j.error).toBe('invalid')
      expect(j.issues.map((i) => i.path)).toContain(Object.keys(spec.params!)[0])
    }
  })

  it('unknown body keys are STRIPPED, never trusted: user_id, id, timestamps come from the server and the path', async () => {
    const gearId = newId()
    const res = await u.call('PUT', `/api/v1/gear/${gearId}`, {
      name: 'Strapped', owned: true, extra: 1,
      user_id: 'someone-else', id: newId(), created_at: '1999-01-01T00:00:00.000Z', deleted_at: '2000-01-01T00:00:00.000Z',
    })
    expect(res.status).toBe(200)
    const row = res.json as Record<string, unknown>
    expect(row.id).toBe(gearId)
    expect(row.user_id).not.toBe('someone-else')
    expect(row.created_at).not.toBe('1999-01-01T00:00:00.000Z')
    expect(row.deleted_at).toBeNull()
    expect(row).not.toHaveProperty('extra')
  })
})

describe('404 for unknown ids', () => {
  it('every id route answers 404 {"error":"not_found"} for a random UUID', async () => {
    // No active session, so POST /sessions reaches the day lookup instead of 409.
    const f = randomFixture(await buildFixture(u, { active: false }))
    for (const spec of ROUTES.filter((r) => r.foreign === 'not_found' || r.foreign === 'public')) {
      const res = await u.call(spec.method, fill(spec, f), spec.body?.(f))
      expect(res.status, label(spec)).toBe(404)
      expect(res.json, label(spec)).toEqual({ error: 'not_found' })
    }
  })
})

describe('body limits', () => {
  it('rejects a body over 1 MB on a normal route with 413 payload_too_large', async () => {
    const res = await u.call('PUT', `/api/v1/gear/${newId()}`, { name: 'x'.repeat(1024 * 1024 + 10), owned: true })
    expect(res.status).toBe(413)
    expect(res.json).toEqual({ error: 'payload_too_large' })
  })

  it('rejects a body over 10 MB on /import with 413 payload_too_large', async () => {
    const res = await u.call('POST', '/api/v1/import', { pad: 'x'.repeat(10 * 1024 * 1024 + 10) })
    expect(res.status).toBe(413)
    expect(res.json).toEqual({ error: 'payload_too_large' })
  })

  it('accepts a ~5 MB import (over the 1 MB limit that applies elsewhere)', async () => {
    const donor = await buildFixture(u)
    const exercises = Array.from({ length: 1100 }, (_, i) => ({
      ...donor.export.exercises[0]!,
      id: newId(),
      name: `Bulk ${i}`,
      notes: 'n'.repeat(4900),
    }))
    const data: ExportData = { ...donor.export, exercises, plan_items: [], progression_rules: [], item_states: [], set_logs: [], workout_sessions: [], plan_days: [], plans: [] }
    const raw = JSON.stringify(data)
    expect(raw.length).toBeGreaterThan(5 * 1000 * 1000)
    expect(raw.length).toBeLessThan(10 * 1024 * 1024)
    const fresh = await signUpClient(h, `big-${newId()}@example.com`)
    const res = await h.request('/api/v1/import', { method: 'POST', rawBody: raw, cookie: fresh.cookie })
    expect(res.status, await res.clone().text()).toBe(204)
    const back = (await fresh.call('GET', '/api/v1/exercises')).json as unknown[]
    expect(back).toHaveLength(1100)
  }, 60_000)
})

describe('errors', () => {
  it('a service failure is the sanitized 500, with nothing internal in the body', async () => {
    const up = await h.signUpVerified(`boom-${newId()}@example.com`)
    const userId = ((await up.json()) as { user: { id: string } }).user.id
    const app = createApp({
      auth: h.auth,
      env: h.env,
      getPublic: () => {
        throw new Error('unused')
      },
      getService: (id) => ({
        ...createService(h.db, id),
        listGear: async () => {
          throw new Error('relation "gear" failed: password=hunter2 select * from secrets')
        },
      }),
    })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const res = await app.request('/api/v1/gear', { headers: { cookie: cookieJar(up) } })
      expect(res.status).toBe(500)
      const text = await res.text()
      expect(JSON.parse(text)).toEqual({ error: 'internal_error' })
      expect(text).not.toContain('hunter2')
      expect(userId).toBeTruthy()
    } finally {
      spy.mockRestore()
    }
  })
})

describe('authentication', () => {
  it('every route is 401 {"error":"unauthorized"} without a session cookie', async () => {
    const f = randomFixture(await buildFixture(u))
    for (const spec of ROUTES) {
      const res = await u.call(spec.method, fill(spec, f), spec.body?.(f), { cookie: null })
      expect(res.status, label(spec)).toBe(401)
      expect(res.json, label(spec)).toEqual({ error: 'unauthorized' })
    }
  })
})

