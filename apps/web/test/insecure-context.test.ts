import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { AppDb } from '../src/repo/db'
import { LocalRepo } from '../src/repo/local-repo'

// Plain-http LAN origins have crypto.getRandomValues but no crypto.randomUUID.
beforeEach(() => {
  const real = globalThis.crypto
  vi.stubGlobal('crypto', {
    randomUUID: undefined,
    getRandomValues: <T extends ArrayBufferView>(a: T) => real.getRandomValues(a as never) as unknown as T,
  })
})
afterEach(() => vi.unstubAllGlobals())

test('LocalRepo starts and saves without crypto.randomUUID', async () => {
  expect(crypto.randomUUID).toBeUndefined()
  const repo = new LocalRepo(new AppDb(`insecure-${Math.random().toString(36).slice(2)}`))
  await repo.init()
  expect(await repo.getProfile()).toMatchObject({ plan: 'free' })
  expect(await repo.listGear()).toHaveLength(8)
  expect(await repo.listExercises()).toHaveLength(16)
  const saved = await repo.saveExercise({
    name: 'Curl',
    notes: '',
    video_url: null,
    required_gear_ids: [],
    active: true,
    default_sets: 3,
    default_reps: 10,
    default_weight: 20,
  })
  expect(saved.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
})
