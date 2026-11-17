import { UnauthenticatedError } from '@workout/shared'
import { expect, test } from 'vitest'
import { AppDb } from '../src/repo/db'
import { LocalRepo } from '../src/repo/local-repo'

async function guest() {
  const repo = new LocalRepo(new AppDb(`guest-nutrition-${crypto.randomUUID()}`))
  await repo.init()
  return repo
}

const entry = {
  date: '2026-11-16',
  name: 'Toast',
  quantity: '1 slice',
  calories: 80,
  protein_g: 3,
  carbs_g: null,
  fat_g: null,
  fiber_g: null,
  sugar_g: null,
  sodium_mg: null,
  source: 'manual' as const,
}

test('every nutrition method on a guest device throws UnauthenticatedError', async () => {
  const repo = await guest()
  await expect(repo.listNutrition('2026-11-16', '2026-11-16')).rejects.toBeInstanceOf(UnauthenticatedError)
  await expect(repo.saveNutritionEntry(entry)).rejects.toBeInstanceOf(UnauthenticatedError)
  await expect(repo.deleteNutritionEntry(crypto.randomUUID())).rejects.toBeInstanceOf(UnauthenticatedError)
  await expect(repo.parseMeal('toast')).rejects.toBeInstanceOf(UnauthenticatedError)
})

test('a guest cannot store nutrition settings, and other profile updates still work', async () => {
  const repo = await guest()
  await expect(repo.updateProfile({ nutrition: { tracked: ['calories'], goals: {} } })).rejects.toBeInstanceOf(UnauthenticatedError)
  expect((await repo.getProfile()).nutrition).toBeUndefined()
  expect((await repo.updateProfile({ weight_increment: 2.5 })).weight_increment).toBe(2.5)
})
