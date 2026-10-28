import { randomUUID } from 'node:crypto'
import { runRepoContract } from '@workout/shared/testing'
import { user } from '../src/db/schema.js'
import { createService } from '../src/service/index.js'
import { withTestDb } from './harness.js'

runRepoContract(
  'Service (Postgres)',
  async (opts) => {
    const { db, cleanup } = await withTestDb()
    const userId = `u_${randomUUID()}`
    await db.insert(user).values({ id: userId, name: userId, email: `${userId}@example.test` })
    const repo = createService(db, userId)
    // An empty account is the import target: it must have no profile yet.
    if (!opts?.empty) await repo.init()
    return { repo, cleanup, importAll: (data) => repo.importAll(data), replaceAll: (data) => repo.replaceAll(data) }
  },
  { groups: ['profile', 'gear', 'exercises', 'plans', 'progression', 'sessions', 'transfer', 'restore', 'community'] },
)
