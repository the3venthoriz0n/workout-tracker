// Community plans (spec §3, §9): publish limits and validation, frozen versions, visibility of
// unpublished/hidden listings, vote and download counters, adoption, the public area's whitelist.
import { newId, type ExportData } from '@workout/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PUBLIC_ROUTES } from '../src/routes/table.js'
import { makeClient, type Client } from './fixture.js'
import { cookieJar, setupApp, type Harness } from './helpers.js'

let h: Harness
beforeAll(async () => {
  h = await setupApp()
})
afterAll(async () => {
  await h?.cleanup()
})

type Json = Record<string, unknown>
type Listing = { id: string; title: string; description: string; level: string | null; author: string; day_count: number; version: number; upvotes: number; downloads: number; updated_at: string }
type Detail = { listing: Listing; version: number; snapshot: { name: string; units: string; days: { name: string; items: { exercise: string; weight: number; sets: number }[] }[] } }

async function ok(c: Client, method: string, path: string, body?: unknown): Promise<unknown> {
  const r = await c.call(method, path, body)
  if (r.status >= 300) throw new Error(`${method} ${path} -> ${r.status} ${r.text}`)
  return r.json
}

let seq = 0
/** Sign-up is rate limited per IP (10 an hour), so every account here signs up from its own address. */
async function signUpClient(_h: Harness, email: string): Promise<Client> {
  const n = ++seq
  const res = await h.signUp(email, undefined, { ip: `10.250.${Math.floor(n / 250)}.${n % 250}` })
  if (res.status !== 200) throw new Error(`sign-up failed: ${res.status}`)
  return makeClient(h, cookieJar(res))
}
async function account(name?: string): Promise<Client & { userId: string }> {
  const c = await signUpClient(h, `community-${newId().slice(0, 8)}@example.com`)
  await ok(c, 'POST', '/api/v1/me/init')
  if (name) await ok(c, 'PATCH', '/api/v1/me', { display_name: name })
  const me = (await ok(c, 'GET', '/api/v1/me')) as { user_id: string }
  return { ...c, userId: me.user_id }
}

const exerciseBody = (name: string, over: Json = {}) => ({
  name, notes: 'SECRET-NOTE', video_url: 'https://video.example.invalid/SECRET-VIDEO', required_gear_ids: [], active: true,
  default_sets: 3, default_reps: 5, default_weight: 100, ...over,
})

/** A plan with one day and one item per exercise name; returns its ids. */
async function makePlan(c: Client, planName = 'My Plan', exercises: string[] = ['Front Squat'], over: Json = {}) {
  const plan = newId()
  const day = newId()
  await ok(c, 'PUT', `/api/v1/plans/${plan}`, { name: planName })
  await ok(c, 'PUT', `/api/v1/days/${day}`, { plan_id: plan, name: 'Day 1' })
  const items: string[] = []
  const exerciseIds: string[] = []
  for (const name of exercises) {
    const ex = newId()
    await ok(c, 'PUT', `/api/v1/exercises/${ex}`, exerciseBody(name, over))
    exerciseIds.push(ex)
    items.push(((await ok(c, 'POST', `/api/v1/days/${day}/items`, { exercise_id: ex })) as { id: string }).id)
  }
  return { plan, day, items, exerciseIds }
}

const publish = (c: Client, plan: string, meta: Json = { title: 'Strong 5x5' }) => c.call('POST', `/api/v1/plans/${plan}/publish`, meta)
async function published(c: Client, plan: string, meta: Json = { title: 'Strong 5x5' }) {
  const r = await publish(c, plan, meta)
  expect(r.status, r.text).toBe(200)
  return r.json as { shared_plan_id: string; version: number }
}
/** A public request: no cookie, no Origin. */
async function pub(path: string, cookie?: string) {
  const res = await h.app.request(`/api/public${path}`, cookie ? { headers: { cookie } } : undefined)
  const text = await res.text()
  return { status: res.status, text, json: text ? (JSON.parse(text) as unknown) : undefined, headers: res.headers }
}
async function counters() {
  return (await h.sql(`select sp.id, sp.upvote_count, sp.download_count,
      (select count(*) from plan_vote v where v.shared_plan_id = sp.id)::int as votes,
      (select count(*) from plan_download d where d.shared_plan_id = sp.id)::int as downloads
    from shared_plan sp`)) as { id: string; upvote_count: number; download_count: number; votes: number; downloads: number }[]
}
async function expectCountersMatchRows() {
  for (const r of await counters()) {
    expect(r.upvote_count, `upvotes of ${r.id}`).toBe(r.votes)
    expect(r.download_count, `downloads of ${r.id}`).toBe(r.downloads)
  }
}
async function mine(c: Client) {
  return (await ok(c, 'GET', '/api/v1/shared-plans/mine')) as { id: string; plan_id: string | null; status: string; version: number; upvotes: number; downloads: number; title: string }[]
}

describe('publishing: validation', () => {
  it('needs a public name, a valid title/description/level and a plan with exercises', async () => {
    const c = await account()
    const { plan } = await makePlan(c)
    const noName = await publish(c, plan)
    expect(noName.status).toBe(400)
    expect((noName.json as { issues: { path: string }[] }).issues.map((i) => i.path)).toContain('display_name')
    await ok(c, 'PATCH', '/api/v1/me', { display_name: 'Lifter One' })
    const bad: [Json, string][] = [
      [{ title: 'ab' }, 'title'],
      [{ title: 'x'.repeat(61) }, 'title'],
      [{ title: 'Go to https://evil.example.invalid' }, 'title'],
      [{ title: 'Good title', description: 'www.evil.example.invalid' }, 'description'],
      [{ title: 'Good title', description: 'x'.repeat(501) }, 'description'],
      [{ title: 'Good title', level: 'elite' }, 'level'],
      [{}, 'title'],
    ]
    for (const [meta, path] of bad) {
      const r = await publish(c, plan, meta)
      expect(r.status, JSON.stringify(meta)).toBe(400)
      expect((r.json as { issues: { path: string }[] }).issues.map((i) => i.path), JSON.stringify(meta)).toContain(path)
    }
    // A plan with only an empty day cannot be shared, and nothing is written.
    const empty = newId()
    await ok(c, 'PUT', `/api/v1/plans/${empty}`, { name: 'Empty' })
    await ok(c, 'PUT', `/api/v1/days/${newId()}`, { plan_id: empty, name: 'Nothing here' })
    const r = await publish(c, empty)
    expect(r.status).toBe(400)
    expect((r.json as { issues: { path: string; message: string }[] }).issues[0]!.message).toMatch(/exercise/i)
    expect(await mine(c)).toEqual([])
    // Unknown, deleted and foreign plans are the same 404.
    expect((await publish(c, newId())).text).toBe('{"error":"not_found"}')
    const other = await account('Lifter Two')
    const theirs = await makePlan(other)
    expect((await publish(c, theirs.plan)).text).toBe('{"error":"not_found"}')
    await ok(c, 'DELETE', `/api/v1/plans/${plan}`)
    expect((await publish(c, plan)).status).toBe(404)
  })

  it('normalizes empty days and a superset of one; publishing deleted exercises is impossible', async () => {
    const c = await account('Normalizer')
    const { plan, day, items, exerciseIds } = await makePlan(c, 'P', ['A lift', 'B lift', 'C lift'])
    await ok(c, 'PUT', `/api/v1/days/${newId()}`, { plan_id: plan, name: 'Empty' })
    await ok(c, 'PUT', `/api/v1/days/${day}/supersets/${newId()}`, { item_ids: [items[0], items[1]] })
    await ok(c, 'DELETE', `/api/v1/exercises/${exerciseIds[1]}`) // its item goes; the superset of one dissolves
    const { shared_plan_id } = await published(c, plan)
    const detail = (await pub(`/plans/${shared_plan_id}`)).json as Detail
    expect(detail.snapshot.days.map((d) => d.name)).toEqual(['Day 1'])
    expect(detail.snapshot.days[0]!.items.map((i) => [i.exercise, (i as Json).superset])).toEqual([['A lift', null], ['C lift', null]])
  })
})

describe('publishing: limits (rolling 24 hours, stored rows)', () => {
  it('allows 5 publish operations per 24 hours, then 429 publish_limit without writing', async () => {
    const c = await account('Busy Lifter')
    const { plan } = await makePlan(c)
    const first = await published(c, plan)
    for (let v = 2; v <= 5; v++) expect((await published(c, plan)).version).toBe(v)
    const other = await makePlan(c, 'Second')
    for (const r of [await publish(c, plan), await publish(c, other.plan)]) {
      expect(r.status).toBe(429)
      expect(r.text).toBe('{"error":"publish_limit"}')
    }
    expect((await mine(c)).map((l) => [l.id, l.version])).toEqual([[first.shared_plan_id, 5]])
    // The window rolls: versions older than 24 hours no longer count.
    await h.sql(`update shared_plan_version set created_at = created_at - interval '24 hours 1 minute'
      where shared_plan_id in (select id from shared_plan where owner_id = '${c.userId}')`)
    expect((await published(c, other.plan)).version).toBe(1)
  })

  it('allows at most 20 live listings; a new version of a live one is fine; unpublishing frees a slot', async () => {
    const c = await account('Prolific')
    const age = () =>
      h.sql(`update shared_plan_version set created_at = created_at - interval '25 hours'
        where shared_plan_id in (select id from shared_plan where owner_id = '${c.userId}')`)
    const plans: string[] = []
    for (let i = 0; i < 20; i++) {
      if (i % 5 === 0) await age()
      const { plan } = await makePlan(c, `Plan ${i}`)
      plans.push(plan)
      await published(c, plan)
    }
    await age()
    const extra = await makePlan(c, 'One too many')
    const r = await publish(c, extra.plan)
    expect(r.status).toBe(429)
    expect(r.text).toBe('{"error":"publish_limit"}')
    expect((await published(c, plans[0]!)).version).toBe(2)
    expect((await c.call('DELETE', `/api/v1/plans/${plans[1]}/publish`)).status).toBe(204)
    expect((await published(c, extra.plan)).version).toBe(1)
    expect((await mine(c)).filter((l) => l.status === 'published')).toHaveLength(20)
  }, 120_000)
})

describe('versions are frozen until re-published', () => {
  it('editing the plan never changes the public snapshot; republishing makes v2 and keeps v1', async () => {
    const c = await account('Versioner')
    const { plan, items } = await makePlan(c, 'Original', ['Squat'])
    const { shared_plan_id, version } = await published(c, plan, { title: 'First title', description: 'About', level: 'beginner' })
    expect(version).toBe(1)
    await ok(c, 'PUT', `/api/v1/plans/${plan}`, { name: 'Edited' })
    await ok(c, 'PATCH', `/api/v1/items/${items[0]}`, { weight: 250, sets: 7 })
    const v1 = (await pub(`/plans/${shared_plan_id}`)).json as Detail
    expect(v1.version).toBe(1)
    expect(v1.snapshot.name).toBe('Original')
    expect(v1.snapshot.days[0]!.items[0]).toMatchObject({ weight: 100, sets: 3 })
    expect(v1.listing).toMatchObject({ title: 'First title', description: 'About', level: 'beginner', author: 'Versioner', version: 1 })
    // The owner sees the plan as published at v1.
    expect(((await ok(c, 'GET', `/api/v1/plans/${plan}`)) as Json).published).toEqual({ shared_plan_id, version: 1, status: 'published' })
    expect((await published(c, plan, { title: 'Second title' })).version).toBe(2)
    const v2 = (await pub(`/plans/${shared_plan_id}`)).json as Detail
    expect(v2).toMatchObject({ version: 2, listing: { title: 'Second title', description: '', level: null, version: 2 } })
    expect(v2.snapshot.days[0]!.items[0]).toMatchObject({ weight: 250, sets: 7 })
    const old = (await pub(`/plans/${shared_plan_id}/versions/1`)).json as Detail
    expect(old).toMatchObject({ version: 1, listing: { version: 2 } })
    expect(old.snapshot.name).toBe('Original')
    expect((await pub(`/plans/${shared_plan_id}/versions/3`)).text).toBe('{"error":"not_found"}')
    expect((await pub(`/plans/${shared_plan_id}/versions/0`)).status).toBe(400)
    expect((await pub(`/plans/not-a-uuid`)).status).toBe(400)
  })
})

describe('visibility: unpublished and hidden listings', () => {
  it('unpublished and hidden are 404 publicly and for votes/adopt; only the owner can unpublish; hidden is final', async () => {
    const a = await account('Owner A')
    const b = await account('Viewer B')
    const { plan } = await makePlan(a, 'Visible')
    const { shared_plan_id: id } = await published(a, plan)
    const random = newId()
    const notFound = async (label: string) => {
      for (const path of [`/plans/${id}`, `/plans/${id}/versions/1`]) {
        const r = await pub(path)
        expect(r.status, `${label} ${path}`).toBe(404)
        expect(r.text).toBe('{"error":"not_found"}')
      }
      const list = (await pub('/plans?sort=new')).json as { items: Listing[] }
      expect(list.items.map((l) => l.id), label).not.toContain(id)
      for (const [method, sub] of [['GET', 'vote'], ['PUT', 'vote'], ['DELETE', 'vote'], ['POST', 'adopt']] as const) {
        const theirs = await b.call(method, `/api/v1/shared-plans/${id}/${sub}`)
        const nobody = await b.call(method, `/api/v1/shared-plans/${random}/${sub}`)
        expect(theirs.status, `${label} ${method} ${sub}`).toBe(404)
        expect(theirs.text).toBe(nobody.text)
      }
    }
    expect((await pub(`/plans/${id}`)).status).toBe(200)
    // B cannot unpublish A's plan (same 404 as a random id); A's listing stays published.
    const theirs = await b.call('DELETE', `/api/v1/plans/${plan}/publish`)
    expect(theirs.status).toBe(404)
    expect(theirs.text).toBe((await b.call('DELETE', `/api/v1/plans/${newId()}/publish`)).text)
    expect((await pub(`/plans/${id}`)).status).toBe(200)

    expect((await a.call('DELETE', `/api/v1/plans/${plan}/publish`)).status).toBe(204)
    expect((await a.call('DELETE', `/api/v1/plans/${plan}/publish`)).status).toBe(204) // idempotent
    await notFound('unpublished')
    expect((await mine(a)).find((l) => l.id === id)).toMatchObject({ status: 'unpublished', plan_id: plan })
    // Re-publishing brings the same listing back as a new version.
    expect(await published(a, plan)).toEqual({ shared_plan_id: id, version: 2 })
    expect((await pub(`/plans/${id}`)).status).toBe(200)

    await h.sql(`update shared_plan set status = 'hidden' where id = '${id}'`)
    await notFound('hidden')
    // The sharer cannot reverse hiding: unpublish changes nothing, publish is refused.
    expect((await a.call('DELETE', `/api/v1/plans/${plan}/publish`)).status).toBe(204)
    const again = await publish(a, plan)
    expect(again.status).toBe(409)
    expect(again.text).toBe('{"error":"conflict"}')
    expect((await mine(a)).find((l) => l.id === id)).toMatchObject({ status: 'hidden', version: 2 })
    expect(((await ok(a, 'GET', `/api/v1/plans/${plan}`)) as Json).published).toEqual({ shared_plan_id: id, version: 2, status: 'hidden' })
  })

  it('deleting the plan unpublishes its listing', async () => {
    const a = await account('Deleter')
    const { plan } = await makePlan(a)
    const { shared_plan_id: id } = await published(a, plan)
    await ok(a, 'DELETE', `/api/v1/plans/${plan}`)
    expect((await pub(`/plans/${id}`)).status).toBe(404)
    expect((await mine(a)).find((l) => l.id === id)).toMatchObject({ status: 'unpublished', plan_id: null })
  })
})

describe('votes', () => {
  it('one upvote per user and listing; PUT and DELETE are idempotent', async () => {
    const a = await account('Voted On')
    const b = await account()
    const { plan } = await makePlan(a)
    const { shared_plan_id: id } = await published(a, plan)
    expect((await ok(b, 'GET', `/api/v1/shared-plans/${id}/vote`)) as Json).toEqual({ voted: false })
    expect(await ok(b, 'PUT', `/api/v1/shared-plans/${id}/vote`)).toEqual({ upvotes: 1 })
    expect(await ok(b, 'PUT', `/api/v1/shared-plans/${id}/vote`)).toEqual({ upvotes: 1 })
    expect(await ok(b, 'GET', `/api/v1/shared-plans/${id}/vote`)).toEqual({ voted: true })
    // Owners cannot upvote their own listing.
    const own = await a.call('PUT', `/api/v1/shared-plans/${id}/vote`)
    expect(own.status).toBe(409)
    expect(own.text).toBe('{"error":"own_listing"}')
    expect(await ok(a, 'GET', `/api/v1/shared-plans/${id}/vote`)).toEqual({ voted: false })
    expect(((await pub(`/plans/${id}`)).json as Detail).listing.upvotes).toBe(1)
    expect(await ok(b, 'DELETE', `/api/v1/shared-plans/${id}/vote`)).toEqual({ upvotes: 0 })
    expect(await ok(b, 'DELETE', `/api/v1/shared-plans/${id}/vote`)).toEqual({ upvotes: 0 })
    expect((await mine(a)).find((l) => l.id === id)?.upvotes).toBe(0)
    await expectCountersMatchRows()
  })

  it('counters equal the real row counts after concurrent votes, toggles, adopts and an unpublish', async () => {
    const owner = await account('Popular')
    const { plan } = await makePlan(owner)
    const { shared_plan_id: id } = await published(owner, plan)
    const voters = await Promise.all(Array.from({ length: 8 }, () => account()))
    const vote = (c: Client, m: 'PUT' | 'DELETE') => c.call(m, `/api/v1/shared-plans/${id}/vote`)
    const adopt = (c: Client) => c.call('POST', `/api/v1/shared-plans/${id}/adopt`, {})
    // Everyone votes twice at once, adopts twice at once, and half of them toggle back.
    await Promise.all(voters.flatMap((c) => [vote(c, 'PUT'), vote(c, 'PUT'), adopt(c), adopt(c)]))
    await expectCountersMatchRows()
    expect(((await pub(`/plans/${id}`)).json as Detail).listing).toMatchObject({ upvotes: 8, downloads: 8 })
    await Promise.all(voters.slice(0, 4).flatMap((c) => [vote(c, 'DELETE'), vote(c, 'PUT'), vote(c, 'DELETE')]))
    await expectCountersMatchRows()
    // An unpublish racing votes: every vote is either counted with its row or refused with 404.
    const results = await Promise.all([
      ...voters.map((c) => vote(c, 'PUT')),
      owner.call('DELETE', `/api/v1/plans/${plan}/publish`),
      ...voters.map((c) => vote(c, 'DELETE')),
    ])
    for (const r of results) expect([200, 204, 404], r.text).toContain(r.status)
    await expectCountersMatchRows()
  })
})

describe('adopting', () => {
  it('counts one download per signed-in user, never for guests; each adopt is a new independent copy', async () => {
    const a = await account('Sharer')
    const b = await account()
    const c = await account()
    const { plan } = await makePlan(a, 'Shared', ['Clean'])
    const { shared_plan_id: id } = await published(a, plan, { title: 'Clean Day' })
    const before = JSON.stringify(((await ok(a, 'GET', '/api/v1/export')) as ExportData).plans)
    // Guests read the public area (and copy locally); nothing is counted.
    await pub(`/plans/${id}`)
    await pub(`/plans/${id}/versions/1`)
    const first = (await b.call('POST', `/api/v1/shared-plans/${id}/adopt`, {})) as { status: number; json: { plan_id: string } }
    const second = (await b.call('POST', `/api/v1/shared-plans/${id}/adopt`, {})) as { status: number; json: { plan_id: string } }
    expect([first.status, second.status]).toEqual([201, 201])
    expect(first.json.plan_id).not.toBe(second.json.plan_id)
    expect(((await pub(`/plans/${id}`)).json as Detail).listing.downloads).toBe(1)
    await ok(c, 'POST', `/api/v1/shared-plans/${id}/adopt`, {})
    expect(((await pub(`/plans/${id}`)).json as Detail).listing.downloads).toBe(2)
    const copy = (await ok(b, 'GET', `/api/v1/plans/${first.json.plan_id}`)) as Json & { days: { items: { exercise: { name: string; notes: string; video_url: string | null } }[] }[] }
    expect(copy.source).toEqual({ shared_plan_id: id, version: 1, title: 'Clean Day', author: 'Sharer' })
    expect(copy.published).toBeNull()
    expect(copy.days[0]!.items[0]!.exercise).toMatchObject({ name: 'Clean', notes: '', video_url: null })
    // Editing a copy touches neither the other copy nor the original.
    await ok(b, 'PUT', `/api/v1/plans/${first.json.plan_id}`, { name: 'Mine now' })
    expect(((await ok(b, 'GET', `/api/v1/plans/${second.json.plan_id}`)) as Json).name).toBe('Shared')
    expect(JSON.stringify(((await ok(a, 'GET', '/api/v1/export')) as ExportData).plans)).toBe(before)
    // The owner may take a copy of their own listing; it is not counted.
    const ownCopy = await a.call('POST', `/api/v1/shared-plans/${id}/adopt`, {})
    expect(ownCopy.status).toBe(201)
    expect(((await pub(`/plans/${id}`)).json as Detail).listing.downloads).toBe(2)
    await expectCountersMatchRows()
  })

  it('loads the snapshot from the database: a client snapshot is ignored; an older version can be chosen', async () => {
    const a = await account('Trusty')
    const b = await account()
    const { plan, items } = await makePlan(a, 'Real plan', ['Real Lift'])
    const { shared_plan_id: id } = await published(a, plan)
    await ok(a, 'PATCH', `/api/v1/items/${items[0]}`, { weight: 150 })
    await published(a, plan)
    const forged = {
      version: 1,
      snapshot: { name: 'FORGED', units: 'lb', days: [{ name: 'X', color: null, items: [{ exercise: 'FORGED', gear: [], supports_angle: false, sets: 1, reps: 1, weight: 1, angle: null, amrap_last: false, superset: null, rule: null }] }] },
      title: 'FORGED',
      author: 'FORGED',
    }
    const r = (await ok(b, 'POST', `/api/v1/shared-plans/${id}/adopt`, forged)) as { plan_id: string }
    const copy = (await ok(b, 'GET', `/api/v1/plans/${r.plan_id}`)) as { name: string; source: Json; days: { items: { weight: number; exercise: { name: string } }[] }[] }
    expect(copy.name).toBe('Real plan')
    expect(copy.source).toMatchObject({ version: 1, title: 'Strong 5x5', author: 'Trusty' })
    expect(copy.days[0]!.items[0]).toMatchObject({ weight: 100, exercise: { name: 'Real Lift' } })
    const latest = (await ok(b, 'POST', `/api/v1/shared-plans/${id}/adopt`, {})) as { plan_id: string }
    expect(((await ok(b, 'GET', `/api/v1/plans/${latest.plan_id}`)) as { days: { items: { weight: number }[] }[] }).days[0]!.items[0]!.weight).toBe(150)
    expect((await b.call('POST', `/api/v1/shared-plans/${id}/adopt`, { version: 3 })).text).toBe('{"error":"not_found"}')
    expect((await b.call('POST', `/api/v1/shared-plans/${id}/adopt`, { version: 0 })).status).toBe(400)
    expect(((await pub(`/plans/${id}`)).json as Detail).listing.downloads).toBe(1)
  })
})

describe('adopting: concurrency and name matching', () => {
  it('concurrent adopts by one user never duplicate exercises or gear; spacing and NFD variants match', async () => {
    const a = await account('Variant Maker')
    const b = await account()
    const gearId = newId()
    await ok(a, 'PUT', `/api/v1/gear/${gearId}`, { name: 'Prowler', owned: true })
    const { plan } = await makePlan(a, 'Variants', ['Prowler Push', 'Cafe\u0301 Squat', 'Bench  Press'], { required_gear_ids: [gearId] })
    const { shared_plan_id: id } = await published(a, plan)
    // B already has "Café Squat" (NFC) and the seeded "Bench Press".
    await ok(b, 'PUT', `/api/v1/exercises/${newId()}`, exerciseBody('Café Squat'))
    const results = await Promise.all([1, 2, 3].map(() => b.call('POST', `/api/v1/shared-plans/${id}/adopt`, {})))
    for (const r of results) expect(r.status, r.text).toBe(201)
    const exercises = (await ok(b, 'GET', '/api/v1/exercises')) as { name: string }[]
    const count = (n: string) => exercises.filter((e) => e.name.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ') === n).length
    expect(count('prowler push')).toBe(1)
    expect(count('café squat')).toBe(1)
    expect(count('bench press')).toBe(1)
    const gearRows = (await ok(b, 'GET', '/api/v1/gear')) as { name: string }[]
    expect(gearRows.filter((g) => g.name === 'Prowler')).toHaveLength(1)
    expect(((await pub(`/plans/${id}`)).json as Detail).listing.downloads).toBe(1)
  })
})

describe('the public area', () => {
  const PUBLIC_KEYS = new Set([
    // list page and detail wrappers
    'items', 'next_cursor', 'listing', 'version', 'snapshot',
    // listing
    'id', 'title', 'description', 'level', 'author', 'day_count', 'upvotes', 'downloads', 'updated_at',
    // snapshot
    'name', 'units', 'days', 'color', 'exercise', 'gear', 'supports_angle', 'sets', 'reps', 'weight', 'angle', 'amrap_last', 'superset', 'rule',
    'success_action', 'success_amount', 'fail_streak_limit', 'deload_pct', 'rep_ceiling',
    // errors
    'error', 'issues', 'path', 'message',
  ])
  const walk = (v: unknown, out: Set<string>) => {
    if (Array.isArray(v)) for (const x of v) walk(x, out)
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) (out.add(k), walk(x, out))
    return out
  }

  it('every public response uses only whitelisted keys and leaks nothing private; GET only, no session read, cacheable', async () => {
    const email = `whitelist-${newId()}@example.com`
    const a = { ...(await signUpClient(h, email)) }
    await ok(a, 'POST', '/api/v1/me/init')
    await ok(a, 'PATCH', '/api/v1/me', { display_name: 'Leak Check' })
    const me = (await ok(a, 'GET', '/api/v1/me')) as { user_id: string }
    const gearId = newId()
    await ok(a, 'PUT', `/api/v1/gear/${gearId}`, { name: 'Trap bar', owned: true })
    const { plan, day, items, exerciseIds } = await makePlan(a, 'Leaky', ['Trap Bar Deadlift', 'Hip Thrust'], { required_gear_ids: [gearId], supports_angle: true })
    await ok(a, 'PATCH', `/api/v1/items/${items[0]}`, { angle: 'incline' })
    await ok(a, 'PUT', `/api/v1/days/${day}/supersets/${newId()}`, { item_ids: items })
    await ok(a, 'PUT', `/api/v1/items/${items[0]}/rule`, { rule: { success_action: 'add_reps', success_amount: 1, fail_streak_limit: 3, deload_pct: 10, rep_ceiling: 12 } })
    const s = await ok(a, 'POST', '/api/v1/sessions', { plan_day_id: day }) as { id: string }
    await ok(a, 'PATCH', `/api/v1/sessions/${s.id}`, { note: 'SECRET-SESSION-NOTE' })
    const { shared_plan_id: id } = await published(a, plan, { title: 'Leak test', description: 'Desc', level: 'advanced' })

    const paths = [
      ...PUBLIC_ROUTES.map((r) => r.sample(id)),
      '/api/public/plans?q=trap', '/api/public/plans?sort=used&limit=1', '/api/public/plans?gear=none&days=1&level=advanced',
      `/api/public/plans/${newId()}`, '/api/public/plans?limit=999', `/api/public/plans/${id}/versions/99`, '/api/public/plans?cursor=bogus',
    ]
    const keys = new Set<string>()
    for (const path of paths) {
      const res = await h.app.request(path)
      const text = await res.text()
      expect(res.status, path).toBeLessThan(500)
      walk(JSON.parse(text), keys)
      for (const secret of [email, me.user_id, plan, day, ...items, ...exerciseIds, gearId, s.id, 'SECRET', 'video.example']) {
        expect(text, `${path} leaks ${secret}`).not.toContain(secret)
      }
      expect(res.headers.get('set-cookie'), path).toBeNull()
      if (res.status === 200) expect(res.headers.get('cache-control'), path).toBe('public, max-age=30')
      // A cookie (even a valid session) changes nothing: the session is never read.
      const withCookie = await h.app.request(path, { headers: { cookie: a.cookie } })
      expect(await withCookie.text(), path).toBe(text)
    }
    expect([...keys].filter((k) => !PUBLIC_KEYS.has(k)), 'keys outside the whitelist').toEqual([])
    const detail = (await pub(`/plans/${id}`)).json as Detail
    expect(detail.snapshot.days[0]!.items[0]).toMatchObject({ exercise: 'Trap Bar Deadlift', gear: ['Trap bar'], angle: 'incline', superset: 'A' })

    // GET only: other methods never reach a handler.
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = await h.request(`/api/public/plans/${id}`, { method, body: {}, cookie: a.cookie })
      expect(res.status, method).toBe(404)
      expect(await res.json()).toEqual({ error: 'not_found' })
    }
    expect((await pub(`/plans/${id}`)).status).toBe(200)
  })

  it('search: case-insensitive over title, description and exercise names; wildcards are literal; bounded input', async () => {
    const c = await account('Searcher')
    const plans = [
      { name: 'P1', title: 'Zebra 100% Strength', description: 'Heavy days', exercises: ['Zercher Squat'], level: 'advanced' },
      { name: 'P2', title: 'Zebra A_B Plan', description: 'Light', exercises: ['Push-up'], level: 'beginner' },
      { name: 'P3', title: 'Zebra Ünïcode Plan', description: 'Für alle', exercises: ['Kettlebell Swing'], level: null },
    ]
    const ids: string[] = []
    for (const p of plans) {
      const { plan } = await makePlan(c, p.name, p.exercises)
      ids.push((await published(c, plan, { title: p.title, description: p.description, level: p.level })).shared_plan_id)
    }
    // P1-P3 need no gear; P4 does.
    const gearId = newId()
    await ok(c, 'PUT', `/api/v1/gear/${gearId}`, { name: 'Rack', owned: true })
    const { plan: geared } = await makePlan(c, 'P4', ['Zebra Rack Pull'], { required_gear_ids: [gearId] })
    ids.push((await published(c, geared, { title: 'Zebra Gear Plan' })).shared_plan_id)
    const search = async (qs: string) => {
      const r = await pub(`/plans?${qs}`)
      expect(r.status, `${qs} ${r.text}`).toBe(200)
      return ((r.json as { items: Listing[] }).items.map((l) => l.id)).filter((x) => ids.includes(x))
    }
    expect(await search('q=zebra')).toHaveLength(4)
    expect(await search('q=ZERCHER')).toEqual([ids[0]])
    expect(await search('q=heavy')).toEqual([ids[0]])
    expect(await search(`q=${encodeURIComponent('100%')}`)).toEqual([ids[0]])
    expect(await search(`q=${encodeURIComponent('%')}`)).toEqual([ids[0]])
    expect(await search('q=_')).toEqual([ids[1]])
    expect(await search(`q=${encodeURIComponent('A_B')}`)).toEqual([ids[1]])
    expect(await search(`q=${encodeURIComponent('ünï')}`)).toEqual([ids[2]])
    expect(await search(`q=${encodeURIComponent("'; drop table shared_plan; --")}`)).toEqual([])
    expect(await search('q=')).toHaveLength(4)
    expect(await search('q=zebra&level=beginner')).toEqual([ids[1]])
    expect(await search('q=zebra&gear=none').then((r) => r.includes(ids[3]!))).toBe(false)
    expect(await search('q=zebra&days=1')).toHaveLength(4)
    expect(await search('q=zebra&days=2')).toEqual([])
    const long = await pub(`/plans?q=${'x'.repeat(5000)}`)
    expect(long.status).toBe(400)
    expect((long.json as { error: string }).error).toBe('invalid')
  })

  it('sorts (top, new, used) and pages with a cursor, at most 20 per page', async () => {
    const c = await account('Sorter')
    const voters = await Promise.all([account(), account()])
    const ids: string[] = []
    for (let i = 0; i < 3; i++) {
      const { plan } = await makePlan(c, `S${i}`, ['Quokka Lift'])
      ids.push((await published(c, plan, { title: `Quokka ${i}` })).shared_plan_id)
    }
    // ids[1]: 2 votes; ids[2]: 1 vote and 2 downloads; ids[0]: nothing.
    for (const v of voters) await ok(v, 'PUT', `/api/v1/shared-plans/${ids[1]}/vote`)
    await ok(voters[0]!, 'PUT', `/api/v1/shared-plans/${ids[2]}/vote`)
    for (const v of voters) await ok(v, 'POST', `/api/v1/shared-plans/${ids[2]}/adopt`, {})
    // Distinct publish times (writes in the same millisecond would tie and fall back to the id).
    for (const [i, id] of ids.entries()) await h.sql(`update shared_plan set updated_at = now() - interval '${10 - i} minutes' where id = '${id}'`)
    const order = async (sort: string) =>
      (((await pub(`/plans?q=quokka&sort=${sort}`)).json as { items: Listing[] }).items.map((l) => l.id))
    expect(await order('top')).toEqual([ids[1], ids[2], ids[0]])
    expect(await order('used')).toEqual([ids[2], ids[1], ids[0]])
    expect(await order('new')).toEqual([ids[2], ids[1], ids[0]])
    for (const sort of ['top', 'new', 'used']) {
      const seen: string[] = []
      let cursor: string | null = null
      for (let page = 0; page < 5; page++) {
        const r = (await pub(`/plans?q=quokka&sort=${sort}&limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)).json as { items: Listing[]; next_cursor: string | null }
        expect(r.items.length).toBeLessThanOrEqual(1)
        seen.push(...r.items.map((l) => l.id))
        cursor = r.next_cursor
        if (!cursor) break
      }
      expect(seen, sort).toEqual(await order(sort))
    }
    const all = (await pub('/plans')).json as { items: Listing[] }
    expect(all.items.length).toBeLessThanOrEqual(20)
    expect((await pub('/plans?cursor=bogus')).status).toBe(400)
    expect((await pub('/plans?limit=21')).status).toBe(400)
    // Tampered cursors are 400 invalid, never a database error.
    const enc = (v: unknown) => encodeURIComponent(Buffer.from(JSON.stringify(v)).toString('base64url'))
    for (const bad of [
      [0, 0, '2026-02-30 10:00:00+00', ids[0]],
      [0, 0, '2026-13-01 10:00:00+00', ids[0]],
      [0, 0, '2026-01-01 25:00:00+00', ids[0]],
      [0, 0, '99999-01-01 10:00:00+00', ids[0]],
      [-1, 0, '2026-01-01 10:00:00+00', ids[0]],
      [1e12, 0, '2026-01-01 10:00:00+00', ids[0]],
      [0, 0, '2026-01-01 10:00:00+00', 'not-a-uuid'],
      { a: 1 },
    ]) {
      for (const sort of ['top', 'new', 'used']) {
        const r = await pub(`/plans?sort=${sort}&cursor=${enc(bad)}`)
        expect(r.status, `${sort} ${JSON.stringify(bad)} ${r.text}`).toBe(400)
        expect((r.json as { error: string }).error).toBe('invalid')
      }
    }
  })
})

describe('export and import', () => {
  it('display_name and source round-trip; the listing link does not travel', async () => {
    const a = await account('Exporter')
    const b = await account('Adopter')
    const { plan } = await makePlan(a)
    const { shared_plan_id: id } = await published(a, plan, { title: 'Portable' })
    const { plan_id } = (await ok(b, 'POST', `/api/v1/shared-plans/${id}/adopt`, {})) as { plan_id: string }
    const exported = (await ok(b, 'GET', '/api/v1/export')) as ExportData
    expect(exported.profile.display_name).toBe('Adopter')
    expect(exported.plans.find((p) => p.id === plan_id)?.source).toEqual({ shared_plan_id: id, version: 1, title: 'Portable', author: 'Exporter' })
    const fresh = await signUpClient(h, `import-${newId()}@example.com`)
    expect((await fresh.call('POST', '/api/v1/import', exported)).status).toBe(204)
    const back = (await ok(fresh, 'GET', '/api/v1/export')) as ExportData
    expect(back.profile.display_name).toBe('Adopter')
    expect(back.plans.find((p) => p.id === plan_id)?.source).toEqual(exported.plans.find((p) => p.id === plan_id)?.source)
    // A's own export does not carry the listing; an import never publishes anything.
    const aExport = (await ok(a, 'GET', '/api/v1/export')) as ExportData
    expect(aExport.plans.every((p) => p.published === null)).toBe(true)
    const carol = await signUpClient(h, `import-${newId()}@example.com`)
    expect((await carol.call('POST', '/api/v1/import', aExport)).status).toBe(204)
    expect(await mine(carol)).toEqual([])
    expect(((await ok(carol, 'GET', `/api/v1/plans/${plan}`)) as Json).published).toBeNull()
  })

  it('import cleans plan source title and author and rejects links in them', async () => {
    const a = await account()
    await makePlan(a)
    const exported = (await ok(a, 'GET', '/api/v1/export')) as ExportData
    const withSource = (title: string, author: string) => {
      const d = JSON.parse(JSON.stringify(exported)) as ExportData
      d.plans[0]!.source = { shared_plan_id: newId(), version: 1, title, author }
      return d
    }
    const bad = await signUpClient(h, `src-${newId()}@example.com`)
    expect((await bad.call('POST', '/api/v1/import', withSource('Visit spam.com', 'Jo'))).status).toBe(400)
    expect((await bad.call('POST', '/api/v1/import', withSource('Fine', 'www\u200b.x.com'))).status).toBe(400)
    const good = await signUpClient(h, `src-${newId()}@example.com`)
    expect((await good.call('POST', '/api/v1/import', withSource('Strong\u0000 5x5\u200b', 'Ｊｏ Lifts'))).status).toBe(204)
    const back = (await ok(good, 'GET', '/api/v1/export')) as ExportData
    expect(back.plans[0]!.source).toMatchObject({ title: 'Strong 5x5', author: 'Jo Lifts' })
  })

  it('an export written before community plans still imports', async () => {
    const a = await account()
    await makePlan(a)
    const exported = (await ok(a, 'GET', '/api/v1/export')) as ExportData
    const old = JSON.parse(JSON.stringify(exported)) as Record<string, unknown> & { profile: Json; plans: Json[] }
    delete old.profile.display_name
    for (const p of old.plans) {
      delete p.source
      delete p.published
    }
    const fresh = await signUpClient(h, `old-${newId()}@example.com`)
    const r = await fresh.call('POST', '/api/v1/import', old)
    expect(r.status, r.text).toBe(204)
    const back = (await ok(fresh, 'GET', '/api/v1/export')) as ExportData
    expect(back.profile.display_name).toBeNull()
    expect(back.plans.every((p) => p.source === null)).toBe(true)
  })
})

describe('public rate limit', () => {
  const appWith = async (deps: { env?: Record<string, unknown>; publicRateLimit?: { max?: number; ipHeaders?: string[]; enabled?: boolean } }) => {
    const { createApp } = await import('../src/app.js')
    const { createPublicService } = await import('../src/service/community.js')
    const { createService } = await import('../src/service/index.js')
    return createApp({
      auth: h.auth,
      env: { ...h.env, ...deps.env } as typeof h.env,
      getService: (u) => createService(h.db, u),
      getPublic: () => createPublicService(h.db),
      ...(deps.publicRateLimit ? { publicRateLimit: deps.publicRateLimit } : {}),
    })
  }
  const hit = (app: Awaited<ReturnType<typeof appWith>>, ip?: string) =>
    app.request('/api/public/plans', ip ? { headers: { 'x-test-client-ip': ip } } : undefined)

  it('allows a burst per client IP, then 429 rate_limited; other IPs and /api/v1 are unaffected', async () => {
    const app = await appWith({ publicRateLimit: { max: 3, ipHeaders: ['x-test-client-ip'] } })
    for (let i = 0; i < 3; i++) expect((await hit(app, '198.51.100.1')).status).toBe(200)
    const limited = await hit(app, '198.51.100.1')
    expect(limited.status).toBe(429)
    expect(await limited.json()).toEqual({ error: 'rate_limited' })
    expect((await hit(app, '198.51.100.2')).status).toBe(200)
    expect((await app.request('/api/v1/me')).status).toBe(401)
  })

  it('defaults to 60 a minute in one shared bucket without an IP header; AUTH_RATE_LIMIT=off disables it outside production only', async () => {
    const statuses = async (app: Awaited<ReturnType<typeof appWith>>, n: number) => {
      const out: number[] = []
      for (let i = 0; i < n; i++) out.push((await hit(app)).status)
      return out
    }
    const dev = await appWith({ env: { NODE_ENV: 'development' } })
    const s = await statuses(dev, 61)
    expect(s.slice(0, 60).every((x) => x === 200)).toBe(true)
    expect(s[60]).toBe(429)
    const off = await appWith({ env: { NODE_ENV: 'development', AUTH_RATE_LIMIT: 'off' } })
    expect((await statuses(off, 61)).every((x) => x === 200)).toBe(true)
    const prod = await appWith({ env: { NODE_ENV: 'production', AUTH_RATE_LIMIT: 'off' }, publicRateLimit: { max: 2 } })
    expect(await statuses(prod, 3)).toEqual([200, 200, 429])
  })
})
