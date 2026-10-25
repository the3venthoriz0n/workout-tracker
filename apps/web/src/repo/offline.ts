import {
  ApiError,
  ConflictError,
  NotFoundError,
  OfflineError,
  UnauthenticatedError,
  newId,
  type ApiRepo,
  type SessionDetail,
  type SetLog,
} from '@workout/shared'
import type { OutboxOp, OutboxStore, SetPatch } from './outbox'

export const RETRY_BASE_MS = 1000
/** Also the "every 30 s while the queue is non-empty" of the spec: the backoff never waits longer than this. */
export const RETRY_CAP_MS = 30_000

/** Delay before the next replay attempt after `failures` consecutive failures (1-based): 1 s, 2 s, 4 s ... capped. */
export function retryDelay(failures: number): number {
  return Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** Math.max(0, Math.min(failures, 30) - 1))
}

export type OfflineState = { pending: number; paused: boolean; version: number }

export type OfflineOptions = {
  /** Called for every queued edit the server rejected with a 4xx (not 401) and that was therefore dropped. */
  onDropped?: (op: OutboxOp, err: unknown) => void
  now?: () => Date
}

export type OfflineControls = {
  /** Number of queued set edits (synchronous; exact once `ready` has resolved). */
  pending(): number
  paused(): boolean
  ready: Promise<void>
  /** Replay queued edits now, serially and in order. Never throws. */
  flush(): Promise<void>
  /** After a 401 and a successful re-sign-in as the SAME account. */
  resume(): void
  /** Stop replaying (a sign-in for another account is about to change the cookie). */
  pause(): void
  subscribe(cb: (s: OfflineState) => void): () => void
  hasOfflineData(): Promise<boolean>
  /** Forget this account's queue and mirror (only after the user confirmed). */
  clear(): Promise<void>
  dispose(): void
}
export type OfflineRepo = ApiRepo & OfflineControls

export function isOfflineRepo(r: unknown): r is OfflineRepo {
  return !!r && typeof (r as OfflineRepo).pending === 'function' && typeof (r as OfflineRepo).flush === 'function'
}

// 4xx other than 401 is permanent for that op; 403 (proxy/origin trouble), 408 and 429 are "try later".
// 502/503/504 on a direct edit mean the server is unreachable, like being offline.
const isGatewayDown = (e: unknown) => e instanceof ApiError && (e.status === 502 || e.status === 503 || e.status === 504)
function isPermanent(e: unknown): boolean {
  if (e instanceof NotFoundError || e instanceof ConflictError) return true
  if (e instanceof ApiError) return e.status >= 400 && e.status < 500 && e.status !== 403 && e.status !== 408 && e.status !== 429
  return false
}

/** Queued edits newer than (or equal to) the row's own stamp win over it. */
function overlay(session: SessionDetail, ops: OutboxOp[]): SessionDetail {
  if (ops.length === 0) return session
  return {
    ...session,
    exercises: session.exercises.map((ex) => ({
      ...ex,
      sets: ex.sets.map((s) => {
        let next = s
        for (const op of ops) {
          if (op.setId === s.id && op.updated_at >= next.updated_at) next = { ...next, ...op.patch, updated_at: op.updated_at }
        }
        return next
      }),
    })),
  }
}

function mapSet(session: SessionDetail, id: string, fn: (s: SetLog) => SetLog): SessionDetail {
  return { ...session, exercises: session.exercises.map((e) => ({ ...e, sets: e.sets.map((s) => (s.id === id ? fn(s) : s)) })) }
}
const findSet = (session: SessionDetail | null | undefined, id: string) =>
  session?.exercises.flatMap((e) => e.sets).find((s) => s.id === id)

export function withOffline(api: ApiRepo, store: OutboxStore, opts: OfflineOptions = {}): OfflineRepo {
  const now = opts.now ?? (() => new Date())
  // `count` only caches the store's size for the synchronous pending(); every decision re-reads the store,
  // because another tab can add or remove ops at any time.
  let count = 0
  let holding = false // discard/clear in progress: replay must not run
  let paused = false
  let failures = 0
  let version = 0
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let running: Promise<void> | null = null
  const listeners = new Set<(s: OfflineState) => void>()

  const emit = () => {
    const s = { pending: count, paused, version }
    for (const l of [...listeners]) l(s)
  }
  const ready = store.list().then(
    (ops) => {
      count = ops.length
      emit()
      if (count > 0) void flush()
    },
    () => undefined,
  )

  function schedule() {
    if (timer || paused || disposed || count === 0) return
    timer = setTimeout(() => {
      timer = null
      void flush()
    }, retryDelay(Math.max(1, failures)))
  }
  const cancelTimer = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }

  async function updateMirrorSet(row: SetLog) {
    const m = await store.getMirror()
    if (m?.session && findSet(m.session, row.id)) await store.putMirror({ session: mapSet(m.session, row.id, () => row) })
  }

  async function replay() {
    await ready
    while (!paused && !disposed && !holding) {
      const [op] = await store.list()
      if (!op) {
        failures = 0
        cancelTimer()
        if (count !== 0) {
          count = 0 // another tab may have drained the queue
          emit()
        }
        return
      }
      try {
        const row = await api.updateSet(op.setId, { ...op.patch, updated_at: op.updated_at })
        await store.remove(op.seq!)
        count = await store.count()
        version++
        // The server's row is authoritative unless a later queued edit of the same set still has to go out.
        if (!(await store.list()).some((o) => o.setId === op.setId)) await updateMirrorSet(row)
        failures = 0
        emit()
      } catch (e) {
        if (e instanceof UnauthenticatedError) {
          paused = true
          cancelTimer()
          emit()
        } else if (isPermanent(e)) {
          await store.remove(op.seq!)
          count = await store.count()
          version++
          emit()
          try {
            opts.onDropped?.(op, e)
          } catch {
            // a failing callback must not stall the queue
          }
        } else {
          failures++ // offline or 5xx: stop and back off
          return
        }
      }
    }
  }

  function flush(): Promise<void> {
    if (running) return running
    running = (async () => {
      try {
        await replay()
      } catch {
        failures++ // storage trouble: treat like any transient failure
      } finally {
        running = null
        schedule()
      }
    })()
    return running
  }

  const onOnline = () => {
    failures = 0
    cancelTimer()
    void flush()
  }
  if (typeof window !== 'undefined') window.addEventListener('online', onOnline)

  const kick = () => {
    if (count > 0 && !paused) void flush()
  }

  async function drainBeforeRead() {
    await ready
    if (!paused && (await store.count()) > 0) await flush()
  }

  async function enqueue(setId: string, fields: SetPatch, stamp: string, cause: unknown): Promise<SetLog> {
    const m = await store.getMirror()
    const cur = findSet(m?.session, setId)
    // Only sets of the mirrored active session can be queued; anything else needs a connection.
    if (!cur || !m?.session) throw cause instanceof Error ? cause : new OfflineError()
    await store.add({ opId: newId(), setId, patch: fields, updated_at: stamp })
    count = await store.count()
    const next: SetLog = { ...cur, ...fields, updated_at: stamp }
    await store.putMirror({ session: mapSet(m.session, setId, () => next) })
    emit()
    return next
  }

  const strip = (p: SetPatch & { updated_at?: string }) => {
    const { updated_at, ...rest } = p
    return { stamp: updated_at, fields: Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) as SetPatch }
  }

  return {
    ...api,
    ready,
    pending: () => count,
    paused: () => paused,
    flush,
    pause() {
      paused = true
      cancelTimer()
      emit()
    },
    resume() {
      paused = false
      failures = 0
      emit()
      kick()
    },
    subscribe(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    async hasOfflineData() {
      await ready
      if ((await store.count()) > 0) return true
      const m = await store.getMirror()
      return !!m?.session
    },
    async clear() {
      cancelTimer()
      holding = true
      try {
        await running // let an in-flight replay finish first
        await store.clear()
        count = 0
      } finally {
        holding = false
      }
      emit()
    },
    dispose() {
      disposed = true
      cancelTimer()
      listeners.clear()
      if (typeof window !== 'undefined') window.removeEventListener('online', onOnline)
    },

    async getProfile() {
      try {
        const p = await api.getProfile()
        await store.putMirror({ profile: p }).catch(() => undefined)
        kick()
        return p
      } catch (e) {
        if (e instanceof OfflineError) {
          const m = await store.getMirror().catch(() => undefined)
          if (m?.profile) return m.profile
        }
        throw e
      }
    },
    async updateProfile(p) {
      const r = await api.updateProfile(p)
      await store.putMirror({ profile: r }).catch(() => undefined)
      return r
    },

    async getActiveSession() {
      await drainBeforeRead()
      try {
        const s = await api.getActiveSession()
        const ops = await store.list()
        const shown = s ? overlay(s, ops) : undefined
        await store.putMirror({ session: shown ?? null }).catch(() => undefined)
        return shown
      } catch (e) {
        if (e instanceof OfflineError) {
          const m = await store.getMirror().catch(() => undefined)
          if (m?.session) return overlay(m.session, await store.list())
        }
        throw e
      }
    },
    async startSession(planDayId) {
      const s = await api.startSession(planDayId)
      await store.putMirror({ session: s }).catch(() => undefined)
      return s
    },
    async updateSet(id, patch) {
      await ready
      const { stamp = now().toISOString(), fields } = strip(patch)
      if (!paused && (await store.count()) > 0) await flush()
      if (paused) return enqueue(id, fields, stamp, new UnauthenticatedError())
      if ((await store.count()) === 0) {
        try {
          const row = await api.updateSet(id, { ...fields, updated_at: stamp })
          await updateMirrorSet(row).catch(() => undefined)
          return row
        } catch (e) {
          if (e instanceof UnauthenticatedError) {
            paused = true
            cancelTimer()
            await enqueue(id, fields, stamp, e).catch(() => undefined)
            emit()
            throw e
          }
          if (!(e instanceof OfflineError) && !isGatewayDown(e)) throw e
          failures++
          const r = await enqueue(id, fields, stamp, e)
          schedule()
          return r
        }
      }
      // Earlier edits could not be sent: keep this one behind them.
      const r = await enqueue(id, fields, stamp, new OfflineError())
      schedule()
      return r
    },
    async finishSession(id) {
      await ready
      if ((await store.count()) > 0) await flush()
      if ((await store.count()) > 0) throw paused ? new UnauthenticatedError() : new OfflineError() // never finish on stale sets
      const r = await api.finishSession(id)
      await store.putMirror({ session: null }).catch(() => undefined)
      return r
    },
    async discardSession(id) {
      holding = true
      try {
        await running // never race an in-flight replay
        await api.discardSession(id)
        await store.removeAllOps().catch(() => undefined)
        count = 0
        await store.putMirror({ session: null }).catch(() => undefined)
      } finally {
        holding = false
      }
      emit()
      kick()
    },
  }
}
