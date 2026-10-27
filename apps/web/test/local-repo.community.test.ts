// Guests and community plans: a v2 guest database upgrades to v3 (display_name, plan source),
// guests cannot publish or vote, and adopting needs the snapshot fetched from the public API.
import Dexie from 'dexie'
import { UnauthenticatedError, ValidationError, newId, type SharedSnapshot } from '@workout/shared'
import { afterEach, expect, test } from 'vitest'
import { AppDb } from '../src/repo/db'
import { LocalRepo } from '../src/repo/local-repo'

const ts = '2026-01-01T00:00:00.000Z'
const sync = { created_at: ts, updated_at: ts, deleted_at: null }
const U = '00000000-0000-4000-8000-000000000001'
const PLAN = '00000000-0000-4000-8000-000000000003'

const open: AppDb[] = []
afterEach(async () => {
  for (const db of open.splice(0)) await db.delete()
})
function fresh(name = `community-${crypto.randomUUID()}`) {
  const db = new AppDb(name)
  open.push(db)
  return { db, repo: new LocalRepo(db) }
}

const snapshot: SharedSnapshot = {
  name: 'Shared plan',
  units: 'lb',
  days: [{ name: 'Day 1', color: null, items: [
    { exercise: 'Back Squat', gear: ['Barbell'], supports_angle: false, sets: 5, reps: 5, weight: 135, angle: null, amrap_last: false, superset: null, rule: null },
  ] }],
}

test('a v2 guest database upgrades with display_name, source and published null', async () => {
  const name = `upgrade-v2-${crypto.randomUUID()}`
  const old = new Dexie(name)
  const stores = {
    profile: 'user_id', gear: 'id', exercises: 'id', plans: 'id', planDays: 'id, plan_id',
    planItems: 'id, plan_day_id, exercise_id', rules: 'plan_item_id', itemStates: 'plan_item_id', sessions: 'id', setLogs: 'id, session_id',
  }
  old.version(1).stores(stores)
  old.version(2).stores({})
  await old.open()
  await old.table('profile').add({ user_id: U, plan: 'free', units: 'lb', weight_increment: 5, ...sync })
  await old.table('plans').add({ id: PLAN, user_id: U, name: 'Old plan', archived: false, ...sync })
  old.close()

  const { db, repo } = fresh(name)
  await repo.init()
  expect(await db.profile.get(U)).toMatchObject({ display_name: null })
  expect(await db.plans.get(PLAN)).toMatchObject({ source: null, published: null })
  expect((await repo.getProfile()).display_name).toBeNull()
  expect(await repo.getPlan(PLAN)).toMatchObject({ name: 'Old plan', source: null, published: null })
  expect((await repo.exportAll()).plans[0]).toMatchObject({ source: null, published: null })
  expect((await repo.updateProfile({ display_name: 'Guest Lifter' })).display_name).toBe('Guest Lifter')
})

test('guests cannot publish, unpublish or vote; they have no listings and no votes', async () => {
  const { repo } = fresh()
  await repo.init()
  const plan = await repo.savePlan({ name: 'Mine' })
  await expect(repo.publishPlan(plan.id, { title: 'My plan' })).rejects.toBeInstanceOf(UnauthenticatedError)
  await expect(repo.unpublishPlan(plan.id)).rejects.toBeInstanceOf(UnauthenticatedError)
  await expect(repo.setVote(newId(), true)).rejects.toBeInstanceOf(UnauthenticatedError)
  expect(await repo.hasVoted(newId())).toBe(false)
  expect(await repo.listMyShared()).toEqual([])
})

test('guest adoption needs a valid snapshot plus the listing title and author, and writes nothing otherwise', async () => {
  const { repo } = fresh()
  await repo.init()
  const id = newId()
  const before = await repo.exportAll()
  const strip = (d: typeof before) => ({ ...d, exported_at: '' })
  await expect(repo.adoptSharedPlan({ shared_plan_id: id, version: 1 })).rejects.toBeInstanceOf(ValidationError)
  await expect(repo.adoptSharedPlan({ shared_plan_id: id, version: 1, snapshot, title: 'Strong', author: '' })).rejects.toBeInstanceOf(ValidationError)
  const broken = structuredClone(snapshot)
  broken.days[0]!.items[0]!.weight = -5
  await expect(repo.adoptSharedPlan({ shared_plan_id: id, version: 1, snapshot: broken, title: 'Strong', author: 'Jo' })).rejects.toBeInstanceOf(ValidationError)
  expect(strip(await repo.exportAll())).toEqual(strip(before))

  const { plan_id } = await repo.adoptSharedPlan({ shared_plan_id: id, version: 2, snapshot, title: 'Strong', author: 'Jo' })
  const copy = await repo.getPlan(plan_id)
  expect(copy).toMatchObject({ name: 'Shared plan', source: { shared_plan_id: id, version: 2, title: 'Strong', author: 'Jo' }, published: null })
  expect(copy?.days[0]?.items[0]).toMatchObject({ sets: 5, reps: 5, weight: 135, exercise: { name: 'Back Squat' } })
  // The guest's own Back Squat was reused, not duplicated.
  expect((await repo.listExercises()).filter((e) => e.name === 'Back Squat')).toHaveLength(1)
})
