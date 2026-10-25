import { ApiError, OfflineError, UnauthenticatedError, createApiRepo, type SessionDetail, type SetLog } from '@workout/shared'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { withOffline, retryDelay, RETRY_CAP_MS, type OfflineRepo } from '../src/repo/offline'
import { OutboxDb, createOutboxStore, dropOtherMirrors } from '../src/repo/outbox'

const T0 = '2026-01-01T10:00:00.000Z'
const t = (n: number) => new Date(Date.parse(T0) + n * 1000).toISOString()

const mkSet = (id: string, no: number): SetLog =>
  ({
    id, session_id: 's1', plan_item_id: 'pi', exercise_id: 'ex', exercise_name: 'Bench', set_no: no, position: no,
    target_reps: 5, target_weight: 100, actual_reps: 5, weight: 100, done: false, note: '', created_at: T0, updated_at: T0,
  }) as unknown as SetLog

const session = (): SessionDetail =>
  ({
    id: 's1', plan_name: 'P', day_name: 'D', note: '', started_at: T0, completed_at: null,
    exercises: [{ plan_item_id: 'pi', exercise_id: 'ex', exercise_name: 'Bench', video_url: null, notes: '', sets: [mkSet('a', 1), mkSet('b', 2)] }],
  }) as unknown as SessionDetail

type Call = { method: string; path: string; body?: Record<string, unknown> }

// A tiny stand-in for the server: LWW on updated_at, switchable connectivity, scripted failures.
function makeServer() {
  const sets = new Map<string, SetLog>([['a', mkSet('a', 1)], ['b', mkSet('b', 2)]])
  const s = {
    online: true,
    calls: [] as Call[],
    patches: [] as { id: string; body: Record<string, unknown> }[],
    statusFor: (_id: string): number | null => null,
    applyThenDrop: false,
    activeSession: true,
    sets,
    fetch: (async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET'
      const path = url.replace('/api/v1', '')
      const body = init.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : undefined
      s.calls.push({ method, path, body })
      if (!s.online) throw new TypeError('network')
      const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status })
      let m
      if ((m = /^\/sets\/(.+)$/.exec(path)) && method === 'PATCH') {
        const id = m[1]!
        s.patches.push({ id, body: body! })
        const forced = s.statusFor(id)
        if (forced) return json(forced, { error: forced === 401 ? 'unauthorized' : 'invalid' })
        const cur = sets.get(id)
        if (!cur) return json(404, { error: 'not_found' })
        const { updated_at, ...rest } = body!
        if ((updated_at as string) >= cur.updated_at) sets.set(id, { ...cur, ...rest, updated_at } as SetLog)
        if (s.applyThenDrop) {
          s.applyThenDrop = false
          throw new TypeError('response lost')
        }
        return json(200, sets.get(id))
      }
      if (path === '/sessions/active') {
        if (!s.activeSession) return json(200, null)
        const d = session()
        d.exercises[0]!.sets = [...sets.values()]
        return json(200, d)
      }
      if (path === '/me') return json(200, { user_id: 'u', units: 'lb' })
      if (method === 'DELETE' && path.startsWith('/sessions/')) return json(200, {})
      if (path.endsWith('/complete')) return json(200, [])
      if (path === '/plans' && method === 'PUT') return json(200, {})
      return json(404, { error: 'not_found' })
    }) as unknown as typeof fetch,
  }
  return s
}

let n = 0
let db: OutboxDb
let dbName: string
const live: OfflineRepo[] = []
function make(server: ReturnType<typeof makeServer>, account = 'acct-a', onDropped = vi.fn(), database = db) {
  const r = withOffline(createApiRepo({ fetch: server.fetch }), createOutboxStore(database, account), {
    onDropped,
  })
  live.push(r)
  return { repo: r, onDropped }
}
async function seedMirror(server: ReturnType<typeof makeServer>, repo: OfflineRepo) {
  await repo.ready
  await repo.getActiveSession()
  void server
}

beforeEach(() => {
  dbName = `outbox-${++n}-${crypto.randomUUID()}`
  db = new OutboxDb(dbName)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  live.splice(0).forEach((r) => r.dispose())
})

test('the active session is mirrored, readable offline and survives a reload', async () => {
  const server = makeServer()
  const { repo } = make(server)
  await seedMirror(server, repo)
  await repo.getProfile()
  server.online = false
  expect((await repo.getActiveSession())?.id).toBe('s1')
  expect((await repo.getProfile()).units).toBe('lb') // profile falls back too once seen
  // new repo + new Dexie connection to the same database = app reload
  repo.dispose()
  const reloaded = make(server, 'acct-a', vi.fn(), new OutboxDb(dbName)).repo
  expect((await reloaded.getActiveSession())?.exercises[0]!.sets).toHaveLength(2)
})

test('an offline set edit updates the mirror at once and is queued; the queue survives a restart', async () => {
  const server = makeServer()
  const { repo } = make(server)
  await seedMirror(server, repo)
  await repo.getProfile()
  server.online = false
  const row = await repo.updateSet('a', { done: true, updated_at: t(5) })
  expect(row.done).toBe(true)
  expect(repo.pending()).toBe(1)
  expect((await repo.getActiveSession())!.exercises[0]!.sets[0]!.done).toBe(true)
  repo.dispose()
  const again = make(server, 'acct-a', vi.fn(), new OutboxDb(dbName)).repo
  await again.ready
  expect(again.pending()).toBe(1)
  expect((await again.getActiveSession())!.exercises[0]!.sets[0]!.done).toBe(true)
})

test('reconnect replays queued edits serially in the order they were made', async () => {
  const server = makeServer()
  const { repo } = make(server)
  await seedMirror(server, repo)
  server.online = false
  await repo.updateSet('a', { done: true, updated_at: t(1) })
  await repo.updateSet('b', { weight: 105, updated_at: t(2) })
  await repo.updateSet('a', { done: false, updated_at: t(3) })
  server.patches.length = 0
  server.online = true
  await repo.flush()
  expect(server.patches.map((p) => [p.id, p.body.updated_at])).toEqual([['a', t(1)], ['b', t(2)], ['a', t(3)]])
  expect(repo.pending()).toBe(0)
  expect(server.sets.get('a')!.done).toBe(false)
  expect(server.sets.get('b')!.weight).toBe(105)
})

test('the online event triggers a replay', async () => {
  const server = makeServer()
  const { repo } = make(server)
  await seedMirror(server, repo)
  server.online = false
  await repo.updateSet('a', { done: true, updated_at: t(1) })
  server.online = true
  window.dispatchEvent(new Event('online'))
  await vi.waitFor(() => expect(repo.pending()).toBe(0))
  expect(server.sets.get('a')!.done).toBe(true)
})

test('a successful call replays what was left in the queue', async () => {
  const server = makeServer()
  const { repo } = make(server)
  await seedMirror(server, repo)
  server.online = false
  await repo.updateSet('a', { done: true, updated_at: t(1) })
  server.online = true
  await repo.getProfile() // a successful call is a trigger
  await vi.waitFor(() => expect(repo.pending()).toBe(0))
})

test('last write wins: a newer server value beats a stale queued edit and the mirror takes the server row', async () => {
  const server = makeServer()
  const { repo } = make(server)
  await seedMirror(server, repo)
  server.online = false
  await repo.updateSet('a', { weight: 110, updated_at: t(1) })
  server.sets.set('a', { ...mkSet('a', 1), weight: 120, updated_at: t(9) }) // edited elsewhere, later
  server.online = true
  await repo.flush()
  expect(repo.pending()).toBe(0)
  expect(server.sets.get('a')!.weight).toBe(120)
  server.online = false
  expect((await repo.getActiveSession())!.exercises[0]!.sets[0]!.weight).toBe(120)
})

test('a 4xx on replay drops that op, reports it and carries on; 429 is retried, not dropped', async () => {
  const server = makeServer()
  const { repo, onDropped } = make(server)
  await seedMirror(server, repo)
  server.online = false
  await repo.updateSet('a', { weight: 1, updated_at: t(1) })
  await repo.updateSet('b', { weight: 2, updated_at: t(2) })
  server.online = true
  server.statusFor = (id) => (id === 'a' ? 400 : null)
  await repo.flush()
  expect(onDropped).toHaveBeenCalledTimes(1)
  expect(onDropped.mock.calls[0]![0]).toMatchObject({ setId: 'a' })
  expect(onDropped.mock.calls[0]![1]).toBeInstanceOf(ApiError)
  expect(repo.pending()).toBe(0)
  expect(server.sets.get('b')!.weight).toBe(2)

  server.online = false
  await repo.updateSet('b', { weight: 3, updated_at: t(3) })
  server.online = true
  server.statusFor = () => 429
  await repo.flush()
  expect(repo.pending()).toBe(1)
  expect(onDropped).toHaveBeenCalledTimes(1)
})

test('a 5xx keeps the op queued', async () => {
  const server = makeServer()
  const { repo, onDropped } = make(server)
  await seedMirror(server, repo)
  server.online = false
  await repo.updateSet('a', { weight: 1, updated_at: t(1) })
  server.online = true
  server.statusFor = () => 503
  await repo.flush()
  expect(repo.pending()).toBe(1)
  expect(onDropped).not.toHaveBeenCalled()
})

test('a 401 pauses the queue (nothing is sent or lost) and resume() continues it', async () => {
  const server = makeServer()
  const { repo, onDropped } = make(server)
  await seedMirror(server, repo)
  server.online = false
  await repo.updateSet('a', { done: true, updated_at: t(1) })
  server.online = true
  server.statusFor = () => 401
  const seen: boolean[] = []
  repo.subscribe((s) => seen.push(s.paused))
  await repo.flush()
  expect(repo.paused()).toBe(true)
  expect(seen).toContain(true)
  expect(repo.pending()).toBe(1)
  expect(onDropped).not.toHaveBeenCalled()

  server.patches.length = 0
  window.dispatchEvent(new Event('online'))
  await repo.flush()
  expect(server.patches).toHaveLength(0) // still paused: no replay on reconnect

  server.statusFor = () => null
  repo.resume()
  await vi.waitFor(() => expect(repo.pending()).toBe(0))
  expect(server.sets.get('a')!.done).toBe(true)
})

test('a live 401 on an edit queues it, pauses and rethrows UnauthenticatedError', async () => {
  const server = makeServer()
  const { repo } = make(server)
  await seedMirror(server, repo)
  server.statusFor = () => 401
  await expect(repo.updateSet('a', { done: true, updated_at: t(1) })).rejects.toBeInstanceOf(UnauthenticatedError)
  expect(repo.paused()).toBe(true)
  expect(repo.pending()).toBe(1)
})

test("one account's queued edits are never replayed for another account", async () => {
  const server = makeServer()
  const a = make(server, 'acct-a').repo
  await seedMirror(server, a)
  server.online = false
  await a.updateSet('a', { done: true, updated_at: t(1) })
  a.dispose()
  server.online = true
  server.patches.length = 0
  const b = make(server, 'acct-b').repo
  await b.ready
  await b.flush()
  expect(b.pending()).toBe(0)
  expect(server.patches).toHaveLength(0)
  expect(server.sets.get('a')!.done).toBe(false)
  // B has no mirror of A's workout
  server.online = false
  await expect(b.getActiveSession()).rejects.toBeInstanceOf(OfflineError)
  // A's queue is still there for A
  const a2 = make(server, 'acct-a').repo
  await a2.ready
  expect(a2.pending()).toBe(1)
  server.online = true
  await a2.flush()
  expect(server.sets.get('a')!.done).toBe(true)
})

test("dropOtherMirrors removes a previous account's mirror but keeps its queue", async () => {
  const server = makeServer()
  const a = make(server, 'acct-a').repo
  await seedMirror(server, a)
  server.online = false
  await a.updateSet('a', { done: true, updated_at: t(1) })
  await dropOtherMirrors(db, 'acct-b')
  expect(await createOutboxStore(db, 'acct-a').getMirror()).toBeUndefined()
  expect(await createOutboxStore(db, 'acct-a').list()).toHaveLength(1)
})

test('replaying the same op twice is harmless (response lost, then re-sent after a restart)', async () => {
  const server = makeServer()
  const { repo } = make(server)
  await seedMirror(server, repo)
  server.online = false
  await repo.updateSet('a', { done: true, weight: 111, updated_at: t(4) })
  server.online = true
  server.applyThenDrop = true // server applied it but the client never saw the answer
  await repo.flush()
  expect(repo.pending()).toBe(1)
  const afterFirst = { ...server.sets.get('a')! }
  repo.dispose()
  const again = make(server, 'acct-a', vi.fn(), new OutboxDb(dbName)).repo
  await again.flush()
  expect(again.pending()).toBe(0)
  expect(server.sets.get('a')).toEqual(afterFirst)
  expect(server.patches.at(-1)!.body.updated_at).toBe(t(4)) // same stamp both times
  // and a third send of an older stamp cannot clobber the newer value
  server.sets.set('a', { ...afterFirst, weight: 130, updated_at: t(8) })
  await createOutboxStore(db, 'acct-a').add({ opId: 'x', setId: 'a', patch: { weight: 1 }, updated_at: t(4) })
  const third = make(server, 'acct-a', vi.fn(), new OutboxDb(dbName)).repo
  await third.flush()
  expect(server.sets.get('a')!.weight).toBe(130)
})

test('retry delays back off exponentially and never exceed the cap; failed replays reschedule with them', async () => {
  expect([1, 2, 3, 4, 5, 6, 7, 50].map(retryDelay)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000])
  expect(RETRY_CAP_MS).toBe(30_000)

  const server = makeServer()
  const { repo } = make(server)
  await seedMirror(server, repo)
  const delays: number[] = []
  const timers: (() => void)[] = []
  const real = globalThis.setTimeout
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number, ...rest: unknown[]) => {
    if ((ms ?? 0) >= 1000) {
      delays.push(ms!)
      timers.push(fn)
      return 0 as never
    }
    return real(fn, ms, ...rest)
  }) as never)
  server.online = false
  await repo.updateSet('a', { done: true, updated_at: t(1) }) // failure 1 -> 1s
  for (let i = 0; i < 7; i++) {
    const fire = timers.shift()!
    fire()
    await repo.flush()
    await new Promise((r) => real(r, 0))
  }
  expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000])
  expect(repo.pending()).toBe(1) // kept, not hot-looping: exactly one timer outstanding
  expect(timers).toHaveLength(1)
})

test('finishing or starting offline throws OfflineError; finishing never runs ahead of queued edits', async () => {
  const server = makeServer()
  const { repo } = make(server)
  await seedMirror(server, repo)
  server.online = false
  await expect(repo.finishSession('s1')).rejects.toBeInstanceOf(OfflineError)
  await expect(repo.startSession('day')).rejects.toBeInstanceOf(OfflineError)
  await repo.updateSet('a', { done: true, updated_at: t(1) })
  server.online = true
  server.statusFor = () => 503
  server.calls.length = 0
  await expect(repo.finishSession('s1')).rejects.toBeInstanceOf(OfflineError)
  expect(server.calls.some((c) => c.path.endsWith('/complete'))).toBe(false)
  server.statusFor = () => null
  await repo.finishSession('s1')
  expect(server.patches.at(-1)!.id).toBe('a')
  expect(repo.pending()).toBe(0)
})

test('non-set mutations offline fail with OfflineError and are not queued; so do sets outside the active session', async () => {
  const server = makeServer()
  const { repo } = make(server)
  await seedMirror(server, repo)
  server.online = false
  await expect(repo.savePlan({ name: 'x' })).rejects.toBeInstanceOf(OfflineError)
  await expect(repo.updateSet('not-in-session', { done: true })).rejects.toBeInstanceOf(OfflineError)
  expect(repo.pending()).toBe(0)
})

test('the active-session mirror is refreshed online, overlays unsent edits and is cleared by finish/discard', async () => {
  const server = makeServer()
  const { repo } = make(server)
  await seedMirror(server, repo)
  server.online = false
  await repo.updateSet('a', { done: true, updated_at: t(1) })
  server.online = true
  server.statusFor = () => 503 // cannot send yet
  expect((await repo.getActiveSession())!.exercises[0]!.sets[0]!.done).toBe(true) // not shown as reverted
  server.statusFor = () => null
  await repo.flush()
  await repo.discardSession('s1')
  server.online = false
  await expect(repo.getActiveSession()).rejects.toBeInstanceOf(OfflineError)
})

test('clear() forgets the account queue and mirror', async () => {
  const server = makeServer()
  const { repo } = make(server)
  await seedMirror(server, repo)
  server.online = false
  await repo.updateSet('a', { done: true, updated_at: t(1) })
  expect(await repo.hasOfflineData()).toBe(true)
  await repo.clear()
  expect(repo.pending()).toBe(0)
  expect(await repo.hasOfflineData()).toBe(false)
})

test('finishSession checks the store, not a per-instance counter (another tab queued an edit)', async () => {
  const server = makeServer()
  const tabA = make(server).repo
  await seedMirror(server, tabA)
  const tabB = make(server, 'acct-a', vi.fn(), new OutboxDb(dbName)).repo // opened while the queue was empty
  await tabB.ready
  server.online = false
  await tabA.updateSet('a', { done: true, updated_at: t(1) })
  server.online = true
  server.calls.length = 0
  await tabB.finishSession('s1')
  const order = server.calls.map((c) => c.method + ' ' + c.path)
  expect(order.findIndex((c) => c === 'PATCH /sets/a')).toBeGreaterThanOrEqual(0)
  expect(order.findIndex((c) => c === 'PATCH /sets/a')).toBeLessThan(order.findIndex((c) => c.endsWith('/complete')))
})

test('two tabs replaying the same queue never drive the pending count negative', async () => {
  const server = makeServer()
  const tabA = make(server).repo
  await seedMirror(server, tabA)
  server.online = false
  await tabA.updateSet('a', { done: true, updated_at: t(1) })
  await tabA.updateSet('b', { done: true, updated_at: t(2) })
  const tabB = make(server, 'acct-a', vi.fn(), new OutboxDb(dbName)).repo
  await tabB.ready
  server.online = true
  await Promise.all([tabA.flush(), tabB.flush()])
  await Promise.all([tabA.flush(), tabB.flush()])
  expect(tabA.pending()).toBe(0)
  expect(tabB.pending()).toBe(0)
})

test('discardSession waits for an in-flight replay and leaves nothing queued', async () => {
  const server = makeServer()
  const { repo } = make(server)
  await seedMirror(server, repo)
  server.online = false
  await repo.updateSet('a', { done: true, updated_at: t(1) })
  await repo.updateSet('b', { done: true, updated_at: t(2) })
  server.online = true
  const inner = server.fetch
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  server.fetch = (async (u: string, i?: RequestInit) => {
    if (i?.method === 'PATCH') await gate
    return inner(u, i)
  }) as typeof fetch
  const { repo: slow } = make(server, 'acct-a', vi.fn(), new OutboxDb(dbName))
  await slow.ready // starts replaying; blocked at the first PATCH
  const discard = slow.discardSession('s1')
  release()
  await discard
  await slow.flush()
  expect(slow.pending()).toBe(0)
  expect(await createOutboxStore(db, 'acct-a').list()).toHaveLength(0)
})

test('a 502/503/504 on a direct edit is queued like being offline; 403 on replay is kept, not dropped', async () => {
  const server = makeServer()
  const { repo, onDropped } = make(server)
  await seedMirror(server, repo)
  server.statusFor = () => 503
  const row = await repo.updateSet('a', { done: true, updated_at: t(1) })
  expect(row.done).toBe(true)
  expect(repo.pending()).toBe(1)
  server.statusFor = () => 403
  await repo.flush()
  expect(repo.pending()).toBe(1)
  expect(onDropped).not.toHaveBeenCalled()
})
