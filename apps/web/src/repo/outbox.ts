import Dexie, { type EntityTable } from 'dexie'
import type { Profile, SessionDetail } from '@workout/shared'

export type SetPatch = { done?: boolean; actual_reps?: number; weight?: number; note?: string }

/** One queued set edit. `opId` and `updated_at` are fixed at enqueue time, so a re-send is harmless. */
export type OutboxOp = {
  seq?: number
  account: string
  opId: string
  setId: string
  patch: SetPatch
  updated_at: string
}

/** Last server-confirmed (plus locally edited) view of the active session. `session: null` = known to be none. */
export type MirrorRow = {
  account: string
  session?: SessionDetail | null
  profile?: Profile
}

export class OutboxDb extends Dexie {
  ops!: EntityTable<OutboxOp, 'seq'>
  mirror!: EntityTable<MirrorRow, 'account'>

  constructor(name = 'workout-tracker-outbox') {
    super(name)
    this.version(1).stores({ ops: '++seq, account', mirror: 'account' })
  }
}

/** Everything is scoped to one account id; another account's rows are never read, replayed or cleared. */
export interface OutboxStore {
  readonly account: string
  list(): Promise<OutboxOp[]> // in enqueue order
  add(op: Omit<OutboxOp, 'seq' | 'account'>): Promise<OutboxOp>
  remove(seq: number): Promise<void>
  removeAllOps(): Promise<void>
  count(): Promise<number>
  getMirror(): Promise<MirrorRow | undefined>
  putMirror(part: Partial<Omit<MirrorRow, 'account'>>): Promise<void> // merges into the single row
  clear(): Promise<void> // this account's ops and mirror
}

export function createOutboxStore(db: OutboxDb, account: string): OutboxStore {
  if (!account) throw new Error('An account id is required')
  const mine = () => db.ops.where('account').equals(account)
  return {
    account,
    list: () => mine().sortBy('seq'),
    async add(op) {
      const row: OutboxOp = { ...op, account }
      const seq = await db.ops.add(row)
      return { ...row, seq }
    },
    async remove(seq) {
      await mine().and((o) => o.seq === seq).delete()
    },
    count: () => mine().count(),
    async removeAllOps() {
      await mine().delete()
    },
    getMirror: () => db.mirror.get(account),
    async putMirror(part) {
      await db.transaction('rw', db.mirror, async () => {
        const cur = (await db.mirror.get(account)) ?? { account }
        await db.mirror.put({ ...cur, ...part, account })
      })
    },
    async clear() {
      await db.transaction('rw', db.ops, db.mirror, async () => {
        await mine().delete()
        await db.mirror.delete(account)
      })
    },
  }
}

/** Another account's mirrored workout must not linger on a shared device (its queued ops are kept). */
export async function dropOtherMirrors(db: OutboxDb, keepAccount: string): Promise<void> {
  await db.mirror.where('account').notEqual(keepAccount).delete()
}
