import { runRepoContract } from '@workout/shared/testing'
import { AppDb } from '../src/repo/db'
import { LocalRepo } from '../src/repo/local-repo'

runRepoContract('LocalRepo', async () => {
  const db = new AppDb(`contract-${crypto.randomUUID()}`)
  const repo = new LocalRepo(db)
  await repo.init()
  return {
    repo,
    cleanup: async () => {
      await db.delete()
    },
  }
})
