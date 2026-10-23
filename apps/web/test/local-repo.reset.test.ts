import { expect, test } from 'vitest'
import { AppDb } from '../src/repo/db'
import { LocalRepo } from '../src/repo/local-repo'

test('reset wipes all data and leaves a fresh seeded guest profile', async () => {
  const repo = new LocalRepo(new AppDb(`reset-${crypto.randomUUID()}`))
  await repo.init()
  const before = await repo.getProfile()
  await repo.savePlan({ name: 'Mine' })
  expect((await repo.listPlans()).length).toBe(1)
  await repo.reset()
  expect(await repo.listPlans()).toEqual([])
  const after = await repo.getProfile()
  expect(after.user_id).not.toBe(before.user_id)
  expect((await repo.listExercises()).length).toBeGreaterThan(0)
})
