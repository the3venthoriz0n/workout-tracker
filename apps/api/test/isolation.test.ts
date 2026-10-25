// Review Focus 1-2: user B can never read, change or learn about user A's data, and every route
// needs a valid session. Cases are generated from ROUTES so a new route cannot be forgotten.
import { newId, type ExportData } from '@workout/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ROUTES, type Fixture } from '../src/routes/table.js'
import { buildFixture, fill, randomFixture, signUpClient, type Client } from './fixture.js'
import { setupApp, type Harness } from './helpers.js'

let h: Harness
let a: Client
let b: Client
let fa: Fixture // A: active session
let fb: Fixture // B: own data, no active session
let fakes: Fixture // ids that belong to nobody
let aCompletedSet: string

/** A's data as one comparable string (export time dropped; everything else must be unchanged). */
async function snapshot(c: Client): Promise<string> {
  const res = await c.call('GET', '/api/v1/export')
  expect(res.status).toBe(200)
  const { exported_at: _t, ...rest } = res.json as ExportData
  return JSON.stringify(rest)
}

const label = (r: { method: string; path: string }) => `${r.method} ${r.path}`

beforeAll(async () => {
  h = await setupApp()
  a = await signUpClient(h, 'alice@example.com')
  b = await signUpClient(h, 'bob@example.com')
  fa = await buildFixture(a)
  fb = await buildFixture(b, { active: false })
  fakes = randomFixture(fa)
  const done = (await a.call('GET', `/api/v1/sessions/${fa.completedSession}`)).json as {
    exercises: { sets: { id: string }[] }[]
  }
  aCompletedSet = done.exercises[0]!.sets[0]!.id
})
afterAll(async () => {
  await h?.cleanup()
})

describe('user B using user A\'s ids', () => {
  const variants = (): [string, Fixture][] => [
    ['A with an active session', fa],
    ['A\'s finished session', { ...fa, session: fa.completedSession, set: aCompletedSet }],
  ]

  for (const [name, which] of [0, 1].map((i) => [i === 0 ? 'active session' : 'finished session', i] as const)) {
    it(`gets the same 404 as for a random id on every id route (${name})`, async () => {
      const [, theirs] = variants()[which]!
      const beforeA = await snapshot(a)
      const beforeB = await snapshot(b)
      let checked = 0
      for (const spec of ROUTES.filter((r) => r.foreign === 'not_found')) {
        const foreign = await b.call(spec.method, fill(spec, theirs), spec.body?.(theirs))
        const nobody = await b.call(spec.method, fill(spec, fakes), spec.body?.(fakes))
        expect(foreign.status, label(spec)).toBe(404)
        expect(foreign.text, label(spec)).toBe('{"error":"not_found"}')
        // Identical to an id that exists nowhere: status, body and the headers that describe it.
        expect(foreign.text, label(spec)).toBe(nobody.text)
        expect(foreign.status, label(spec)).toBe(nobody.status)
        expect(foreign.headers.get('content-type'), label(spec)).toBe(nobody.headers.get('content-type'))
        checked++
      }
      expect(checked).toBe(ROUTES.filter((r) => r.foreign === 'not_found').length)
      expect(await snapshot(a), 'A\'s data must be byte-identical').toBe(beforeA)
      expect(await snapshot(b), 'B\'s data must be untouched too').toBe(beforeB)
    })
  }

  it('also gets 404 for A\'s ids inside bodies (parents and references)', async () => {
    const beforeA = await snapshot(a)
    const attempts: [string, string, unknown][] = [
      ['POST', `/api/v1/days/${fa.day}/items`, { exercise_id: fb.exercise }], // A's day
      ['POST', `/api/v1/days/${fb.day}/items`, { exercise_id: fa.exercise }], // A's exercise
      ['PUT', `/api/v1/days/${newId()}`, { plan_id: fa.plan, name: 'Hijack' }], // A's plan as parent
      ['PUT', `/api/v1/days/${fb.day}`, { plan_id: fa.plan, name: 'Hijack' }], // B's day moved under A's plan
      ['POST', '/api/v1/sessions', { plan_day_id: fa.day }], // start on A's day
      ['POST', '/api/v1/move', { kind: 'day', id: fa.day, direction: 1 }],
      ['POST', '/api/v1/move', { kind: 'item', id: fa.item, direction: -1 }],
      ['PUT', `/api/v1/items/${fa.item}/rule`, { rule: null }],
      ['DELETE', `/api/v1/items/${fa.item}/rule`, {}],
      ['PUT', `/api/v1/exercises/${fa.exercise}/rule`, { rule: null }],
      ['PATCH', `/api/v1/items/${fa.item}`, { angle: 'flat' }],
      ['PUT', `/api/v1/days/${fb.day}/supersets/${newId()}`, { item_ids: [fa.item, fa.item2] }], // A's items, B's day
      ['PUT', `/api/v1/days/${fb.day}/supersets/${newId()}`, { item_ids: [fb.item, fa.item] }], // one of A's items
      ['PUT', `/api/v1/days/${fa.day}/supersets/${fa.group}`, { item_ids: null }], // dissolve A's group
      ['PUT', `/api/v1/days/${fa.day}/supersets/${newId()}`, { item_ids: [fb.item, fb.item2] }], // B's items, A's day
    ]
    for (const [method, path, body] of attempts) {
      const res = await b.call(method, path, body)
      expect(res.status, `${method} ${path}`).toBe(404)
      expect(res.text).toBe('{"error":"not_found"}')
    }
    expect(await snapshot(a)).toBe(beforeA)
    // B's own day was not re-parented either.
    const bPlan = (await b.call('GET', `/api/v1/plans/${fb.plan}`)).json as { days: { id: string }[] }
    expect(bPlan.days.map((d) => d.id)).toContain(fb.day)
  })

  it('never sees A\'s rows in any list, and an active session of A is not B\'s', async () => {
    const idsOfA = new Set<string>()
    const ex = (await a.call('GET', '/api/v1/export')).json as Record<string, unknown>
    for (const v of Object.values(ex)) {
      if (Array.isArray(v)) for (const row of v as { id?: string }[]) if (row.id) idsOfA.add(row.id)
    }
    expect(idsOfA.size).toBeGreaterThan(8)
    for (const path of ['gear', 'exercises', 'plans', 'sessions', 'progression', 'export', 'sessions/active', 'me']) {
      const res = await b.call('GET', `/api/v1/${path}`)
      expect(res.status, path).toBe(200)
      for (const id of idsOfA) expect(res.text, `${path} leaks ${id}`).not.toContain(id)
      expect(res.text, path).not.toContain('alice@example.com')
    }
    expect((await b.call('GET', '/api/v1/sessions/active')).text).toBe('null')
  })

  it('B reusing A\'s superset group id groups B\'s own items only', async () => {
    const beforeA = await snapshot(a)
    const res = await b.call('PUT', `/api/v1/days/${fb.day}/supersets/${fa.group}`, { item_ids: [fb.item, fb.item2] })
    expect(res.status, res.text).toBe(200)
    const bTree = (await b.call('GET', `/api/v1/plans/${fb.plan}`)).json as { days: { items: { superset_group: string | null }[] }[] }
    expect(bTree.days[0]!.items.map((i) => i.superset_group)).toEqual([fa.group, fa.group])
    expect(await snapshot(a)).toBe(beforeA)
    // and B dissolving "that" group leaves A's group alone
    expect((await b.call('PUT', `/api/v1/days/${fb.day}/supersets/${fa.group}`, { item_ids: null })).status).toBe(200)
    expect(await snapshot(a)).toBe(beforeA)
    const aTree = (await a.call('GET', `/api/v1/plans/${fa.plan}`)).json as { days: { items: { superset_group: string | null }[] }[] }
    expect(aTree.days[0]!.items.map((i) => i.superset_group)).toEqual([fa.group, fa.group])
  })

  it('PUT with A\'s id creates B\'s OWN row and leaves A\'s untouched (composite keys)', async () => {
    const beforeA = await snapshot(a)
    const g = await b.call('PUT', `/api/v1/gear/${fa.gear}`, { name: 'Bob gear', owned: false })
    const e = await b.call('PUT', `/api/v1/exercises/${fa.exercise}`, {
      name: 'Bob exercise', notes: '', video_url: null, required_gear_ids: [], active: true,
      default_sets: 1, default_reps: 1, default_weight: 1,
    })
    const p = await b.call('PUT', `/api/v1/plans/${fa.plan}`, { name: 'Bob plan' })
    expect([g.status, e.status, p.status]).toEqual([200, 200, 200])
    const bobUser = ((await b.call('GET', '/api/v1/me')).json as { user_id: string }).user_id
    expect((g.json as { user_id: string }).user_id).toBe(bobUser)
    expect((e.json as { user_id: string }).user_id).toBe(bobUser)
    expect((p.json as { user_id: string }).user_id).toBe(bobUser)
    // B's lists now show B's rows under those ids; A's data is byte-identical.
    const gear = (await b.call('GET', '/api/v1/gear')).json as { id: string; name: string }[]
    expect(gear.find((x) => x.id === fa.gear)?.name).toBe('Bob gear')
    expect(await snapshot(a)).toBe(beforeA)
    // B deleting "that" id deletes B's row only.
    expect((await b.call('DELETE', `/api/v1/gear/${fa.gear}`)).status).toBe(204)
    expect((await b.call('DELETE', `/api/v1/plans/${fa.plan}`)).status).toBe(204)
    expect((await b.call('DELETE', `/api/v1/exercises/${fa.exercise}`)).status).toBe(204)
    expect(await snapshot(a)).toBe(beforeA)
    expect(((await a.call('GET', `/api/v1/plans/${fa.plan}`)).json as { name: string }).name).toBe('Plan A')
  })

  it('an import full of A\'s rows (A\'s user_id, A\'s ids) lands under the importer only', async () => {
    const beforeA = await snapshot(a)
    const c = await signUpClient(h, 'carol@example.com')
    const res = await c.call('POST', '/api/v1/import', fa.export)
    expect(res.status, res.text).toBe(204)
    const mine = (await c.call('GET', '/api/v1/export')).json as ExportData
    const cUser = mine.profile.user_id
    expect(cUser).not.toBe(fa.export.profile.user_id)
    for (const table of ['gear', 'exercises', 'plans', 'workout_sessions'] as const) {
      expect(mine[table].length, table).toBeGreaterThan(0)
      for (const row of mine[table]) expect(row.user_id, table).toBe(cUser)
    }
    expect(mine.set_logs.length).toBe(fa.export.set_logs.length)
    // Carol can now edit "her" copy without touching Alice's.
    await c.call('PUT', `/api/v1/gear/${fa.gear}`, { name: 'Carol edit', owned: true })
    expect(await snapshot(a)).toBe(beforeA)
    const again = await c.call('POST', '/api/v1/import', fa.export)
    expect(again.status).toBe(409)
  })
})

describe('authentication on every route', () => {
  it('no cookie, a tampered cookie, a garbage cookie and a signed-out cookie are all 401', async () => {
    const d = await signUpClient(h, 'dave@example.com')
    const real = a.cookie
    // Replace one character with a different one, whatever it was (a fixed letter collides ~1 in 60 runs).
    const tampered = real.replace(/(=[^;]{4})([^;])/, (_m, p: string, c: string) => `${p}${c === 'Z' ? 'Y' : 'Z'}`)
    expect(tampered).not.toBe(real)
    const forged = real.split(';').map((kv) => kv.replace(/=.*/, '=forged-token.forged-signature')).join('; ')
    const out = await h.request('/api/auth/sign-out', { method: 'POST', body: {}, cookie: d.cookie })
    expect(out.status).toBe(200)
    const cookies: [string, string | null][] = [
      ['none', null],
      ['tampered', tampered],
      ['forged', forged],
      ['signed out', d.cookie],
      ['wrong name', 'session=abc'],
    ]
    for (const spec of ROUTES) {
      for (const [what, cookie] of cookies) {
        const res = await a.call(spec.method, fill(spec, fa), spec.body?.(fa), { cookie })
        expect(res.status, `${label(spec)} with ${what} cookie`).toBe(401)
        expect(res.text).toBe('{"error":"unauthorized"}')
      }
    }
  })

  it('a hostile Origin on a state-changing route is rejected before any handler runs', async () => {
    const before = await snapshot(a)
    for (const spec of ROUTES.filter((r) => r.method !== 'GET')) {
      const res = await h.request(fill(spec, fa), {
        method: spec.method,
        body: spec.body?.(fa) ?? {},
        cookie: a.cookie,
        origin: 'https://evil.example',
      })
      expect(res.status, label(spec)).toBe(403)
    }
    expect(await snapshot(a)).toBe(before)
  })
})

describe('PUT upserts with another user\'s id create the caller\'s own row', () => {
  const specs = ROUTES.filter((r) => r.foreign === 'upsert' || r.upsertWithOwnParents)
  it('the table has upserts, including days', () => {
    expect(specs.length).toBeGreaterThanOrEqual(4)
    expect(specs.some((s) => s.path.includes('/days/'))).toBe(true)
  })
  it.each(specs.map((s) => [label(s), s] as const))('%s', async (_n, spec) => {
    const beforeA = await snapshot(a)
    // A's id in the path; B's OWN ids in the body (own parents), so only the path id is foreign.
    const res = await b.call(spec.method, fill(spec, fa), spec.body?.(fb))
    expect(res.status, res.text).toBe(200)
    const row = res.json as { id: string; user_id?: string }
    const bobUser = ((await b.call('GET', '/api/v1/me')).json as { user_id: string }).user_id
    if (row.user_id) expect(row.user_id).toBe(bobUser)
    const mine = (await b.call('GET', '/api/v1/export')).json as Record<string, { id?: string; user_id?: string }[]>
    const kind = spec.path.split('/')[3]!
    const table = { gear: 'gear', exercises: 'exercises', plans: 'plans', days: 'plan_days' }[kind]!
    expect(mine[table]!.some((r) => r.id === Object.values(spec.params!).map((k) => fa[k])[0])).toBe(true)
    expect(await snapshot(a), 'A is untouched').toBe(beforeA)
  })
})

describe('route table completeness', () => {
  const sample = (p: string) => p.replace(/:\w+/g, newId()).replace(/\*/g, 'x')

  it('every registered /api/v1 route is in ROUTES, and every ROUTES entry is registered', () => {
    const registered = h.app.routes
      .filter((r) => r.method !== 'ALL' && r.path.startsWith('/api/v1/'))
      .map((r) => `${r.method} ${r.path}`)
    const known = ROUTES.map(label)
    expect(registered.filter((r) => !known.includes(r)), 'registered but missing from ROUTES (add it, with its foreign-id behaviour)').toEqual([])
    expect(known.filter((r) => !registered.includes(r)), 'in ROUTES but not registered').toEqual([])
    expect(new Set(known).size).toBe(known.length)
  })

  it('every other route under /api (ALL included) except /api/auth/* requires a session', async () => {
    const extras = h.app.routes.filter(
      (r) =>
        r.path.startsWith('/api') &&
        !r.path.startsWith('/api/auth/') &&
        !ROUTES.some((t) => t.method === r.method && t.path === r.path),
    )
    expect(extras.length).toBeGreaterThan(0)
    for (const r of extras) {
      for (const method of r.method === 'ALL' ? ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] : [r.method]) {
        const res = await a.call(method, sample(r.path), method === 'GET' ? undefined : {}, { cookie: null })
        // The only unauthenticated answers allowed: 401, the guards that run before auth (403/413/415),
        // and the data-free JSON 404 for paths outside /api/v1.
        const ok =
          res.status === 401 ||
          [403, 413, 415].includes(res.status) ||
          (res.status === 404 && res.text === '{"error":"not_found"}' && !sample(r.path).startsWith('/api/v1/'))
        expect(ok, `${method} ${r.path} -> ${res.status} ${res.text}`).toBe(true)
        expect(res.text).not.toMatch(/user|email|session/i)
      }
    }
  })

  it('every route that takes an id (path or body) declares how foreign ids behave', () => {
    const probe: Fixture = {
      gear: newId(), exercise: newId(), plan: newId(), day: newId(), item: newId(), item2: newId(), group: newId(),
      session: newId(), set: newId(), completedSession: newId(), export: {} as ExportData,
    }
    const ids = ['gear', 'exercise', 'plan', 'day', 'item', 'item2', 'group', 'session', 'set'].map(
      (k) => probe[k as keyof Fixture] as string,
    )
    for (const spec of ROUTES) {
      const names = [...spec.path.matchAll(/:(\w+)/g)].map((m) => m[1]!)
      expect(Object.keys(spec.params ?? {}).sort(), label(spec)).toEqual(names.sort())
      const bodyText = JSON.stringify(spec.body?.(probe) ?? null)
      const bodyHasId = ids.some((id) => bodyText.includes(id))
      if (names.length > 0 || bodyHasId) expect(spec.foreign, label(spec)).not.toBe('none')
    }
  })
})
