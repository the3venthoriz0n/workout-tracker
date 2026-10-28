// Account deletion and export (spec §3, §9): DELETE /api/v1/account with the password removes every
// personal row in one transaction, keeps published listings as "Deleted user", fixes the
// community counters, and ends every session. Export covers everything the account owns.
import { newId, type ExportData } from '@workout/shared'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeClient, type Client } from './fixture.js'
import { GOOD_PASSWORD, cookieJar, freshIp, setupApp, type Harness } from './helpers.js'

let h: Harness
beforeAll(async () => {
  h = await setupApp()
})
afterAll(async () => {
  await h?.cleanup()
})

type Me = Client & { userId: string; email: string }

let seq = 0
/** A verified, signed-in, initialised account; each signs up from its own address (per-IP limits). */
async function account(name?: string, email = `acct-${newId().slice(0, 8)}@example.com`): Promise<Me> {
  const n = ++seq
  const res = await h.signUpVerified(email, GOOD_PASSWORD, { ip: `10.249.${Math.floor(n / 250)}.${n % 250}` })
  if (res.status !== 200) throw new Error(`sign-up failed: ${res.status}`)
  const c = makeClient(h, cookieJar(res))
  await ok(c, 'POST', '/api/v1/me/init')
  if (name) await ok(c, 'PATCH', '/api/v1/me', { display_name: name })
  const me = (await ok(c, 'GET', '/api/v1/me')) as { user_id: string }
  return { ...c, userId: me.user_id, email }
}

async function ok(c: Client, method: string, path: string, body?: unknown): Promise<unknown> {
  const r = await c.call(method, path, body)
  if (r.status >= 300) throw new Error(`${method} ${path} -> ${r.status} ${r.text}`)
  return r.json
}

/** A plan with one day and one exercise; returns its id. */
async function makePlan(c: Client, name = 'Plan') {
  const [plan, day, ex] = [newId(), newId(), newId()]
  await ok(c, 'PUT', `/api/v1/exercises/${ex}`, {
    name: `Squat ${ex.slice(0, 4)}`, notes: `Private note of ${name}`, video_url: null, required_gear_ids: [], active: true,
    default_sets: 3, default_reps: 5, default_weight: 100,
  })
  await ok(c, 'PUT', `/api/v1/plans/${plan}`, { name })
  await ok(c, 'PUT', `/api/v1/days/${day}`, { plan_id: plan, name: 'Day 1' })
  await ok(c, 'POST', `/api/v1/days/${day}/items`, { exercise_id: ex })
  return { plan, day }
}

async function publish(c: Client, title: string) {
  const { plan } = await makePlan(c, title)
  const r = (await ok(c, 'POST', `/api/v1/plans/${plan}/publish`, { title })) as { shared_plan_id: string }
  return { plan, id: r.shared_plan_id }
}

const del = (c: Client, password: unknown = GOOD_PASSWORD, cookie?: string) =>
  c.call('DELETE', '/api/v1/account', { password }, cookie === undefined ? {} : { cookie })

async function expectCountersMatchRows() {
  const rows = (await h.sql(`select sp.id, sp.upvote_count, sp.download_count,
      (select count(*) from plan_vote v where v.shared_plan_id = sp.id)::int as votes,
      (select count(*) from plan_download d where d.shared_plan_id = sp.id)::int as downloads
    from shared_plan sp`)) as { id: string; upvote_count: number; download_count: number; votes: number; downloads: number }[]
  for (const r of rows) {
    expect(r.upvote_count, `upvotes of ${r.id}`).toBe(r.votes)
    expect(r.download_count, `downloads of ${r.id}`).toBe(r.downloads)
  }
}

/** Every row of every table in the test schema, as one string (to search for leftovers). */
async function dumpAll(): Promise<string> {
  const tables = (await h.sql(
    `select table_name from information_schema.tables where table_schema = '${h.schemaName}' and table_type = 'BASE TABLE'`,
  )) as { table_name: string }[]
  const out: Record<string, unknown> = {}
  for (const { table_name } of tables) out[table_name] = await h.sql(`select * from "${table_name}"`)
  return JSON.stringify(out)
}

/** Rows that still carry the user id in a user_id or owner_id column, per table. */
async function rowsOf(userId: string): Promise<Record<string, number>> {
  const cols = (await h.sql(
    `select table_name, column_name from information_schema.columns
     where table_schema = '${h.schemaName}' and column_name in ('user_id', 'owner_id', 'userId')`,
  )) as { table_name: string; column_name: string }[]
  const out: Record<string, number> = {}
  for (const { table_name, column_name } of cols) {
    const [r] = (await h.sql(`select count(*)::int as n from "${table_name}" where "${column_name}" = '${userId}'`)) as { n: number }[]
    if (r!.n > 0) out[`${table_name}.${column_name}`] = r!.n
  }
  return out
}

async function exportOf(c: Client): Promise<string> {
  const { exported_at: _t, ...rest } = (await ok(c, 'GET', '/api/v1/export')) as ExportData
  return JSON.stringify(rest)
}

describe('DELETE /api/v1/account: password check', () => {
  it('a wrong, missing or malformed password deletes nothing and says nothing else', async () => {
    const u = await account('Careful Lifter')
    const before = await exportOf(u)
    const wrong = await del(u, 'not my password at all')
    expect(wrong.status).toBe(403)
    expect(wrong.text).toBe('{"error":"invalid_password"}')
    expect(wrong.headers.get('set-cookie')).toBeNull()
    for (const bad of ['', 123, null, 'x'.repeat(129)]) {
      const r = await del(u, bad)
      expect(r.status, JSON.stringify(bad)).toBe(400)
    }
    const noBody = await u.call('DELETE', '/api/v1/account', {})
    expect(noBody.status).toBe(400)
    expect(await exportOf(u)).toBe(before)
    expect((await u.call('GET', '/api/v1/me')).status).toBe(200)
  })

  it('is rate limited per account like sign-in (5 a minute), even with the right password after that', async () => {
    const u = await account()
    const other = await account()
    for (let i = 0; i < 5; i++) expect((await del(u, `wrong password ${i}`)).status).toBe(403)
    const limited = await del(u, GOOD_PASSWORD)
    expect(limited.status).toBe(429)
    expect(limited.json).toEqual({ error: 'rate_limited' })
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0)
    expect((await u.call('GET', '/api/v1/me')).status).toBe(200)
    // Another account has its own budget.
    expect((await del(other, 'wrong password')).status).toBe(403)
  })

  it('needs a session, a trusted Origin and a JSON body', async () => {
    const u = await account()
    const noCookie = await h.request('/api/v1/account', { method: 'DELETE', body: { password: GOOD_PASSWORD } })
    expect(noCookie.status).toBe(401)
    const evil = await h.request('/api/v1/account', {
      method: 'DELETE', body: { password: GOOD_PASSWORD }, cookie: u.cookie, origin: 'https://evil.example',
    })
    expect(evil.status).toBe(403)
    const form = await h.request('/api/v1/account', {
      method: 'DELETE', rawBody: `password=${GOOD_PASSWORD}`, cookie: u.cookie, contentType: 'application/x-www-form-urlencoded',
    })
    expect(form.status).toBe(415)
    expect((await u.call('GET', '/api/v1/me')).status).toBe(200)
  })
})

describe('DELETE /api/v1/account: what is removed and what stays', () => {
  it('removes every personal row, keeps published listings as "Deleted user", fixes the counters', async () => {
    const owner = await account('Other Owner')
    const bystander = await account('Bystander')
    const u = await account('Leaving Lifter')
    // A second session of u on another device.
    const second = await h.signIn(u.email, GOOD_PASSWORD, { ip: freshIp() })
    expect(second.status).toBe(200)
    const secondCookie = cookieJar(second)

    // u's listings: one published, one unpublished, one hidden.
    const kept = await publish(u, 'Kept Program')
    const gone = await publish(u, 'Unpublished Program')
    await ok(u, 'DELETE', `/api/v1/plans/${gone.plan}/publish`)
    const hidden = await publish(u, 'Hidden Program')
    await h.sql(`update shared_plan set status = 'hidden' where id = '${hidden.id}'`)
    // Another user's listing that u voted on and adopted.
    const theirs = await publish(owner, 'Their Program')
    await ok(u, 'PUT', `/api/v1/shared-plans/${theirs.id}/vote`)
    await ok(u, 'POST', `/api/v1/shared-plans/${theirs.id}/adopt`, {})
    // Others voted on and adopted u's published listing (and the unpublished one, before).
    await ok(owner, 'PUT', `/api/v1/shared-plans/${kept.id}/vote`)
    const copy = (await ok(owner, 'POST', `/api/v1/shared-plans/${kept.id}/adopt`, {})) as { plan_id: string }
    await ok(bystander, 'PUT', `/api/v1/shared-plans/${kept.id}/vote`)
    // u has history and an active session, and a pending reset link.
    const { day } = await makePlan(u, 'Training')
    const s = (await ok(u, 'POST', '/api/v1/sessions', { plan_day_id: day })) as { id: string }
    await ok(u, 'POST', `/api/v1/sessions/${s.id}/complete`)
    await ok(u, 'POST', '/api/v1/sessions', { plan_day_id: day })
    await h.request('/api/auth/request-password-reset', { method: 'POST', body: { email: u.email }, ip: freshIp() })
    await h.lastMail(u.email, '/reset-password')

    const bystanderBefore = await exportOf(bystander)

    const res = await del(u)
    expect(res.status, res.text).toBe(204)
    expect(res.text).toBe('')
    // The session cookie is cleared in the response.
    const cleared = res.headers.getSetCookie().find((c) => c.includes('session_token='))
    expect(cleared, 'clears the session cookie').toBeDefined()
    expect(cleared).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i)

    // Every session is gone: the old cookie and the other device's cookie are both 401.
    for (const cookie of [u.cookie, secondCookie]) {
      const r = await u.call('GET', '/api/v1/me', undefined, { cookie })
      expect(r.status).toBe(401)
      expect(r.text).toBe('{"error":"unauthorized"}')
    }
    // No row anywhere carries the user id; the email and display name appear nowhere.
    expect(await rowsOf(u.userId)).toEqual({})
    const dump = await dumpAll()
    expect(dump).not.toContain(u.userId)
    expect(dump).not.toContain(u.email)
    expect(dump).not.toContain('Leaving Lifter')
    for (const note of ['Kept Program', 'Unpublished Program', 'Hidden Program', 'Training']) {
      expect(dump).not.toContain(`Private note of ${note}`)
    }
    const verif = (await h.sql(`select count(*)::int as n from verification where value = '${u.userId}'`)) as { n: number }[]
    expect(verif[0]!.n).toBe(0)

    // The published listing stays, anonymised; the others are gone with their versions.
    const listings = (await h.sql(`select id, owner_id, status from shared_plan where id in ('${kept.id}', '${gone.id}', '${hidden.id}')`)) as {
      id: string; owner_id: string | null; status: string
    }[]
    expect(listings).toEqual([{ id: kept.id, owner_id: null, status: 'published' }])
    const versions = (await h.sql(`select shared_plan_id from shared_plan_version where shared_plan_id in ('${gone.id}', '${hidden.id}')`)) as unknown[]
    expect(versions).toEqual([])
    const pub = await h.app.request(`/api/public/plans/${kept.id}`)
    expect(pub.status).toBe(200)
    const detail = (await pub.json()) as { listing: { author: string; upvotes: number; downloads: number } }
    expect(detail.listing).toMatchObject({ author: 'Deleted user', upvotes: 2, downloads: 1 })
    const list = (await (await h.app.request('/api/public/plans?q=kept')).json()) as { items: { id: string; author: string }[] }
    expect(list.items.find((i) => i.id === kept.id)?.author).toBe('Deleted user')
    // The owner's copy no longer names the deleted user.
    const copied = (await ok(owner, 'GET', `/api/v1/plans/${copy.plan_id}`)) as { source: { author: string; title: string } }
    expect(copied.source).toMatchObject({ author: 'Deleted user', title: 'Kept Program' })

    // u's vote and download on the other listing were taken back.
    const their = (await (await h.app.request(`/api/public/plans/${theirs.id}`)).json()) as { listing: { upvotes: number; downloads: number } }
    expect(their.listing).toMatchObject({ upvotes: 0, downloads: 0 })
    await expectCountersMatchRows()

    // A bystander's data is untouched.
    expect(await exportOf(bystander)).toBe(bystanderBefore)

    // The kept listing still works for everyone else: vote, unvote, adopt; nobody owns it.
    expect((await ok(bystander, 'DELETE', `/api/v1/shared-plans/${kept.id}/vote`)) as unknown).toEqual({ upvotes: 1 })
    expect((await ok(bystander, 'PUT', `/api/v1/shared-plans/${kept.id}/vote`)) as unknown).toEqual({ upvotes: 2 })
    await ok(bystander, 'POST', `/api/v1/shared-plans/${kept.id}/adopt`, {})
    for (const c of [owner, bystander]) {
      const mine = (await ok(c, 'GET', '/api/v1/shared-plans/mine')) as { id: string }[]
      expect(mine.map((l) => l.id)).not.toContain(kept.id)
    }
    await expectCountersMatchRows()
  })

  it('the same email can sign up again and gets a brand new, empty account', async () => {
    const email = `again-${newId().slice(0, 8)}@example.com`
    const u = await account('First Life', email)
    await publish(u, 'First Life Plan')
    expect((await del(u)).status).toBe(204)

    const again = await h.signUpVerified(email, 'a brand new password', { ip: freshIp() })
    expect(again.status).toBe(200)
    const c = makeClient(h, cookieJar(again))
    // New user id, no profile until first use, then only the starter library.
    expect((await c.call('GET', '/api/v1/me')).status).toBe(404)
    await ok(c, 'POST', '/api/v1/me/init')
    const me = (await ok(c, 'GET', '/api/v1/me')) as { user_id: string; display_name: string | null }
    expect(me.user_id).not.toBe(u.userId)
    expect(me.display_name).toBeNull()
    expect(await ok(c, 'GET', '/api/v1/plans')).toEqual([])
    expect(await ok(c, 'GET', '/api/v1/sessions')).toEqual([])
    expect(await ok(c, 'GET', '/api/v1/shared-plans/mine')).toEqual([])
    // The old password no longer works.
    expect((await h.signIn(email, GOOD_PASSWORD, { ip: freshIp() })).status).toBe(401)
  })

  it('counters stay equal to the real rows when votes and adopts race a deletion', async () => {
    for (let round = 0; round < 3; round++) {
      const a = await account(`Racer A${round}`)
      const b = await account(`Racer B${round}`)
      const u = await account(`Racer U${round}`)
      const la = await publish(a, `Race A ${round}`)
      const lb = await publish(b, `Race B ${round}`)
      const lu = await publish(u, `Race U ${round}`)
      await ok(u, 'PUT', `/api/v1/shared-plans/${la.id}/vote`)
      await ok(u, 'POST', `/api/v1/shared-plans/${la.id}/adopt`, {})
      const results = await Promise.all([
        del(u),
        // The deleting user votes and adopts elsewhere at the same time.
        u.call('PUT', `/api/v1/shared-plans/${lb.id}/vote`),
        u.call('DELETE', `/api/v1/shared-plans/${la.id}/vote`),
        u.call('POST', `/api/v1/shared-plans/${lb.id}/adopt`, {}),
        // Others vote on the same listings concurrently.
        a.call('PUT', `/api/v1/shared-plans/${lb.id}/vote`),
        b.call('PUT', `/api/v1/shared-plans/${la.id}/vote`),
        a.call('PUT', `/api/v1/shared-plans/${lu.id}/vote`),
        b.call('POST', `/api/v1/shared-plans/${lu.id}/adopt`, {}),
      ])
      // The user row is locked first, so the deletion never deadlocks with the user's own writes.
      expect(results[0]!.status, results[0]!.text).toBe(204)
      // The concurrent requests of the deleted user end in success, 401 or a sanitized 500 (FK gone).
      for (const r of results.slice(1, 4)) expect([200, 201, 401, 404, 500], r.text).toContain(r.status)
      for (const r of results.slice(4)) expect([200, 201], r.text).toContain(r.status)
      expect(await rowsOf(u.userId)).toEqual({})
      await expectCountersMatchRows()
    }
  })
})

describe('GET /api/v1/export covers everything the account owns', () => {
  it('includes the account email, the public name, listings with versions, votes and downloads; import ignores them', async () => {
    const owner = await account('Export Owner')
    const theirs = await publish(owner, 'Their Export Plan')
    const u = await account('Export Lifter')
    const mine = await publish(u, 'My Export Plan')
    await ok(u, 'POST', `/api/v1/plans/${mine.plan}/publish`, { title: 'My Export Plan v2' })
    await ok(u, 'PUT', `/api/v1/shared-plans/${theirs.id}/vote`)
    await ok(u, 'POST', `/api/v1/shared-plans/${theirs.id}/adopt`, {})

    const data = (await ok(u, 'GET', '/api/v1/export')) as ExportData
    expect(data.profile.display_name).toBe('Export Lifter')
    expect(data.account).toMatchObject({ email: u.email })
    expect(typeof data.account?.created_at).toBe('string')
    expect(data.community?.listings).toHaveLength(1)
    const l = data.community!.listings[0]!
    expect(l).toMatchObject({ id: mine.id, plan_id: mine.plan, title: 'My Export Plan v2', status: 'published', version: 2 })
    expect(l.versions.map((v) => v.version)).toEqual([1, 2])
    expect(l.versions[0]!.snapshot).toMatchObject({ name: 'My Export Plan' })
    expect(data.community?.votes).toEqual([{ shared_plan_id: theirs.id, created_at: expect.any(String) }])
    expect(data.community?.downloads).toEqual([{ shared_plan_id: theirs.id, first_version: 1, created_at: expect.any(String) }])

    // The export still imports into a fresh account; account and community data are not imported.
    const fresh = await h.signUpVerified(`import-${newId().slice(0, 8)}@example.com`, GOOD_PASSWORD, { ip: freshIp() })
    const f = makeClient(h, cookieJar(fresh))
    const imp = await f.call('POST', '/api/v1/import', data)
    expect(imp.status, imp.text).toBe(204)
    const back = (await ok(f, 'GET', '/api/v1/export')) as ExportData
    expect(back.account?.email).not.toBe(u.email)
    expect(back.community).toEqual({ listings: [], votes: [], downloads: [] })
  })
})

describe('Better Auth endpoints a session holder could use to test passwords or change the account', () => {
  // Unused by the web app; disabled so a stolen cookie gets no password oracle without the
  // per-account limit, and nothing changes the account outside our own routes.
  const DISABLED = [
    '/verify-password', '/change-password', '/change-email', '/update-user', '/delete-user', '/delete-user/callback',
    '/update-session', '/list-sessions', '/revoke-session', '/revoke-sessions', '/revoke-other-sessions',
    '/list-accounts', '/account-info', '/unlink-account', '/link-social', '/get-access-token', '/refresh-token',
    // No verification mail is ever sent: sign-up mails the set-up (password) link instead.
    '/verify-email', '/send-verification-email',
  ]

  it('answer 404 over HTTP and change nothing; DELETE /account (which checks the password directly) still works', async () => {
    const u = await account('Oracle Target')
    const bodies: Record<string, unknown> = {
      '/verify-password': { password: GOOD_PASSWORD },
      '/change-password': { currentPassword: GOOD_PASSWORD, newPassword: 'another long password', revokeOtherSessions: true },
      '/change-email': { newEmail: `x-${newId().slice(0, 6)}@example.com` },
      '/update-user': { name: 'Changed' },
      '/delete-user': { password: GOOD_PASSWORD },
    }
    for (const path of DISABLED) {
      for (const method of ['GET', 'POST']) {
        const res = await h.request(`/api/auth${path}`, { method, body: method === 'POST' ? (bodies[path] ?? {}) : undefined, cookie: u.cookie, ip: freshIp() })
        expect(res.status, `${method} ${path}`).toBe(404)
      }
    }
    // The password and the account are unchanged.
    expect((await h.signIn(u.email, GOOD_PASSWORD, { ip: freshIp() })).status).toBe(200)
    expect((await u.call('GET', '/api/v1/me')).status).toBe(200)
    const [row] = (await h.sql(`select name from "user" where id = '${u.userId}'`)) as { name: string }[]
    expect(row!.name).not.toBe('Changed')
    expect((await del(u)).status).toBe(204)
  })

  it('the flows the web app uses stay enabled', async () => {
    for (const path of ['/get-session', '/sign-out', '/sign-in/email', '/sign-up/email', '/request-password-reset', '/reset-password']) {
      const res = await h.request(`/api/auth${path}`, { method: path === '/get-session' ? 'GET' : 'POST', body: path === '/get-session' ? undefined : {}, ip: freshIp() })
      expect(res.status, path).not.toBe(404)
    }
  })
})

describe('a copy taken while the author deletes the account never keeps the old public name', () => {
  /** Holds a row lock on the listing until `release` is called, so the order of the two writers is fixed. */
  function blockListing(id: string) {
    let release!: () => void
    const released = new Promise<void>((r) => (release = r))
    let locked!: () => void
    const isLocked = new Promise<void>((r) => (locked = r))
    const done = h.db.transaction(async (tx) => {
      await tx.execute(sql`select id from shared_plan where id = ${id} for update`)
      locked()
      await released
    })
    return { isLocked, release, done }
  }
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

  for (const first of ['adopt', 'delete'] as const) {
    it(`${first} first`, async () => {
      const author = `Racing Author ${first}`
      const u = await account(author)
      const o = await account(`Racing Copier ${first}`)
      const listing = await publish(u, `Race ${first} plan`)
      const block = blockListing(listing.id)
      await block.isLocked
      const run = { adopt: () => o.call('POST', `/api/v1/shared-plans/${listing.id}/adopt`, {}), delete: () => del(u) }
      const a = run[first]()
      await pause(150)
      const b = run[first === 'adopt' ? 'delete' : 'adopt']()
      await pause(150)
      block.release()
      await block.done
      const results = await Promise.all([a, b])
      for (const r of results) expect([200, 201, 204], r.text).toContain(r.status)
      const plans = (await ok(o, 'GET', '/api/v1/plans')) as { source: { author: string } | null }[]
      const copies = plans.filter((p) => p.source)
      expect(copies.length).toBe(1)
      expect(copies[0]!.source!.author).toBe('Deleted user')
      expect(await dumpAll()).not.toContain(author)
      await expectCountersMatchRows()
    })
  }
})
