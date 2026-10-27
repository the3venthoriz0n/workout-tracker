import { newId, type ExportData } from '@workout/shared'
import { randomInt } from 'node:crypto'
import { cookieJar, type Harness } from './helpers.js'
import type { Fixture, RouteSpec } from '../src/routes/table.js'

export type Client = ReturnType<typeof makeClient>

export function makeClient(h: Harness, cookie: string) {
  async function call(method: string, path: string, body?: unknown, over: { cookie?: string | null } = {}) {
    const needsBody = method !== 'GET'
    const res = await h.request(path, {
      method,
      body: body ?? (needsBody ? {} : undefined),
      cookie: over.cookie === null ? undefined : (over.cookie ?? cookie),
    })
    const text = await res.text()
    return { status: res.status, text, json: text ? (JSON.parse(text) as unknown) : undefined, headers: res.headers }
  }
  return { cookie, call, h }
}

export async function signUpClient(h: Harness, email: string): Promise<Client> {
  const res = await h.signUpVerified(email)
  if (res.status !== 200) throw new Error(`sign-up failed: ${res.status}`)
  return makeClient(h, cookieJar(res))
}

const must = <T>(v: T | undefined | null, what: string): T => {
  if (v === undefined || v === null) throw new Error(`fixture: ${what} missing`)
  return v
}

type Opts = { active?: boolean }

/**
 * One published listing per client, reused by later fixtures: publishing is limited to 5 a day
 * per account (spec §9), and the route tests build a fixture for every case.
 */
const listings = new WeakMap<Client, { shared: string; publishedPlan: string }>()

/**
 * `shared` is someone else's listing (owners cannot upvote their own): one publisher account per
 * harness, signed up from its own address.
 */
const publishers = new WeakMap<Harness, Promise<string>>()
function othersListing(h: Harness): Promise<string> {
  let p = publishers.get(h)
  if (!p) {
    p = (async () => {
      const ip = `10.251.${randomInt(250)}.${randomInt(250)}`
      const res = await h.signUpVerified(`publisher-${newId()}@example.com`, undefined, { ip })
      if (res.status !== 200) throw new Error(`publisher sign-up failed: ${res.status}`)
      const c = makeClient(h, cookieJar(res))
      const ok = async (method: string, path: string, body?: unknown) => {
        const r = await c.call(method, path, body)
        if (r.status >= 300) throw new Error(`publisher ${method} ${path} -> ${r.status} ${r.text}`)
        return r.json
      }
      await ok('POST', '/api/v1/me/init')
      await ok('PATCH', '/api/v1/me', { display_name: 'Fixture Publisher' })
      const [ex, plan, day] = [newId(), newId(), newId()]
      await ok('PUT', `/api/v1/exercises/${ex}`, {
        name: 'Front Squat', notes: '', video_url: null, required_gear_ids: [], active: true, default_sets: 3, default_reps: 5, default_weight: 100,
      })
      await ok('PUT', `/api/v1/plans/${plan}`, { name: 'Publisher plan' })
      await ok('PUT', `/api/v1/days/${day}`, { plan_id: plan, name: 'Day 1' })
      await ok('POST', `/api/v1/days/${day}/items`, { exercise_id: ex })
      return ((await ok('POST', `/api/v1/plans/${plan}/publish`, { title: 'Publisher plan' })) as { shared_plan_id: string }).shared_plan_id
    })()
    publishers.set(h, p)
  }
  return p
}

async function ensureListing(c: Client, ok: (m: string, p: string, b?: unknown) => Promise<unknown>, plan: string) {
  const shared = await othersListing(c.h)
  return { ...(await ensureOwnListing(c, ok, plan)), shared }
}

async function ensureOwnListing(c: Client, ok: (m: string, p: string, b?: unknown) => Promise<unknown>, plan: string) {
  const me = (await ok('GET', '/api/v1/me')) as { display_name: string | null }
  if (!me.display_name) await ok('PATCH', '/api/v1/me', { display_name: 'Fixture Lifter' })
  const cached = listings.get(c)
  if (cached) {
    const mine = (await ok('GET', '/api/v1/shared-plans/mine')) as { id: string; plan_id: string | null; status: string }[]
    const row = mine.find((l) => l.id === cached.shared)
    if (row?.status === 'published') return cached
    if (row?.plan_id) {
      await ok('POST', `/api/v1/plans/${row.plan_id}/publish`, { title: 'Fixture plan' })
      return cached
    }
  }
  const made = (await ok('POST', `/api/v1/plans/${plan}/publish`, { title: 'Fixture plan' })) as { shared_plan_id: string }
  const next = { shared: made.shared_plan_id, publishedPlan: plan }
  listings.set(c, next)
  return next
}

/**
 * Builds one user's data through the public API: gear, exercise (with a default rule), plan, day,
 * an item with a rule plus a second item in a superset with it, a finished session and (unless `active: false`) a second, active session with its sets,
 * a public name and a published community listing (the first fixture's plan, reused afterwards),
 * and `shared`: another account's published listing.
 */
export async function buildFixture(c: Client, opts: Opts = {}): Promise<Fixture> {
  const ok = async (method: string, path: string, body?: unknown) => {
    const r = await c.call(method, path, body)
    if (r.status >= 300) throw new Error(`fixture ${method} ${path} -> ${r.status} ${r.text}`)
    return r.json
  }
  const active = (await ok('GET', '/api/v1/sessions/active')) as { id: string } | null
  if (active) await ok('DELETE', `/api/v1/sessions/${active.id}`)
  await ok('POST', '/api/v1/me/init')
  const f = { gear: newId(), exercise: newId(), plan: newId(), day: newId() }
  await ok('PUT', `/api/v1/gear/${f.gear}`, { name: `Rack ${f.gear.slice(0, 4)}`, owned: true })
  await ok('PUT', `/api/v1/exercises/${f.exercise}`, {
    name: 'Bench Press',
    notes: 'n',
    video_url: null,
    required_gear_ids: [f.gear],
    active: true,
    supports_angle: true,
    default_sets: 2,
    default_reps: 5,
    default_weight: 95,
  })
  await ok('PUT', `/api/v1/plans/${f.plan}`, { name: 'Plan A' })
  await ok('PUT', `/api/v1/days/${f.day}`, { plan_id: f.plan, name: 'Day 1' })
  const item = (await ok('POST', `/api/v1/days/${f.day}/items`, { exercise_id: f.exercise })) as { id: string }
  await ok('PUT', `/api/v1/items/${item.id}/rule`, {
    rule: { success_action: 'add_weight', success_amount: 5, fail_streak_limit: 3, deload_pct: 10, rep_ceiling: null },
  })
  // A second item on the day, superset with the first, so routes that take two items or a group have real ids.
  const item2 = (await ok('POST', `/api/v1/days/${f.day}/items`, { exercise_id: f.exercise })) as { id: string }
  const group = newId()
  await ok('PUT', `/api/v1/days/${f.day}/supersets/${group}`, { item_ids: [item.id, item2.id] })
  await ok('PATCH', `/api/v1/items/${item2.id}`, { angle: 'incline', amrap_last: true })
  await ok('PUT', `/api/v1/exercises/${f.exercise}/rule`, {
    rule: { success_action: 'add_reps', success_amount: 1, fail_streak_limit: 3, deload_pct: 10, rep_ceiling: 8 },
  })

  const first = (await ok('POST', '/api/v1/sessions', { plan_day_id: f.day })) as { id: string }
  await ok('POST', `/api/v1/sessions/${first.id}/complete`)
  let session = ''
  let set = ''
  if (opts.active !== false) {
    const second = (await ok('POST', '/api/v1/sessions', { plan_day_id: f.day })) as {
      id: string
      exercises: { sets: { id: string }[] }[]
    }
    session = second.id
    set = must(second.exercises[0]?.sets[0]?.id, 'set')
  } else {
    // Without an active session, `session` and `set` point at the finished one.
    const done = (await ok('GET', `/api/v1/sessions/${first.id}`)) as { exercises: { sets: { id: string }[] }[] }
    session = first.id
    set = must(done.exercises[0]?.sets[0]?.id, 'set')
  }
  const listing = await ensureListing(c, ok, f.plan)
  const exported = (await ok('GET', '/api/v1/export')) as ExportData
  return { ...f, item: item.id, item2: item2.id, group, session, set, completedSession: first.id, ...listing, export: exported }
}

/** A fixture whose ids all belong to nobody. */
export function randomFixture(like: Fixture): Fixture {
  return {
    gear: newId(),
    exercise: newId(),
    plan: newId(),
    day: newId(),
    item: newId(),
    item2: newId(),
    group: newId(),
    session: newId(),
    set: newId(),
    completedSession: newId(),
    shared: newId(),
    publishedPlan: newId(),
    export: like.export,
  }
}

export function fill(spec: RouteSpec, f: Fixture): string {
  return spec.path.replace(/:(\w+)/g, (_m, name: string) => must(f[must(spec.params?.[name], `param ${name}`)], name))
}
