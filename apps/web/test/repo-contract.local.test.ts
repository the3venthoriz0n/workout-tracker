import { runRepoContract } from '@workout/shared/testing'
import { AppDb } from '../src/repo/db'
import { LocalRepo } from '../src/repo/local-repo'

runRepoContract('LocalRepo', async (opts) => {
  const db = new AppDb(`contract-${crypto.randomUUID()}`)
  const repo = new LocalRepo(db)
  // An empty device is the first-time import target; an initialised one is the restore target.
  if (!opts?.empty) await repo.init()
  return {
    repo,
    cleanup: async () => {
      await db.delete()
    },
    // LocalRepo has one import: it replaces everything on the device (into an empty one, too).
    importAll: (data) => repo.importAll(data),
    replaceAll: (data) => repo.importAll(data),
  }
})
