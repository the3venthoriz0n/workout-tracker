// A guest database written by the previous release (Dexie schema v1, rows without the day colour,
// angle, AMRAP, superset and layered-rule fields) must open, keep its meaning and keep working.
import Dexie from 'dexie'
import { defaultRule } from '@workout/shared'
import { expect, test } from 'vitest'
import { AppDb } from '../src/repo/db'
import { LocalRepo } from '../src/repo/local-repo'

const ts = '2026-01-01T00:00:00.000Z'
const sync = { created_at: ts, updated_at: ts, deleted_at: null }
const U = '00000000-0000-4000-8000-000000000001'
const EX = '00000000-0000-4000-8000-000000000002'
const PLAN = '00000000-0000-4000-8000-000000000003'
const DAY = '00000000-0000-4000-8000-000000000004'
const WITH_RULE = '00000000-0000-4000-8000-000000000005'
const NO_RULE = '00000000-0000-4000-8000-000000000006'
const SESSION = '00000000-0000-4000-8000-000000000007'

async function writeV1(name: string) {
  const old = new Dexie(name)
  old.version(1).stores({
    profile: 'user_id',
    gear: 'id',
    exercises: 'id',
    plans: 'id',
    planDays: 'id, plan_id',
    planItems: 'id, plan_day_id, exercise_id',
    rules: 'plan_item_id',
    itemStates: 'plan_item_id',
    sessions: 'id',
    setLogs: 'id, session_id',
  })
  await old.open()
  await old.table('profile').add({ user_id: U, plan: 'free', units: 'lb', weight_increment: 5, ...sync })
  await old.table('exercises').add({
    id: EX, user_id: U, name: 'Bench Press', notes: '', video_url: null, required_gear_ids: [], active: true,
    default_sets: 2, default_reps: 5, default_weight: 100, ...sync,
  })
  await old.table('plans').add({ id: PLAN, user_id: U, name: 'Old plan', archived: false, ...sync })
  await old.table('planDays').add({ id: DAY, plan_id: PLAN, name: 'Old day', position: 0, ...sync })
  const item = (id: string, position: number) => ({
    id, plan_day_id: DAY, exercise_id: EX, position, sets: null, reps: null, weight: null,
    target_reps: null, target_weight: null, ...sync,
  })
  await old.table('planItems').bulkAdd([item(WITH_RULE, 0), item(NO_RULE, 1)])
  // v1 gave every new item a rule row; a missing row meant the user chose "no progression".
  await old.table('rules').add({ ...defaultRule(5), success_amount: 10, plan_item_id: WITH_RULE, ...sync })
  await old.table('itemStates').bulkAdd([
    { plan_item_id: WITH_RULE, fail_streak: 0, ...sync },
    { plan_item_id: NO_RULE, fail_streak: 0, ...sync },
  ])
  await old.table('sessions').add({
    id: SESSION, user_id: U, plan_day_id: DAY, plan_name: 'Old plan', day_name: 'Old day', started_at: ts,
    completed_at: ts, note: '', ...sync,
  })
  const log = (id: string, plan_item_id: string, position: number, set_no: number) => ({
    id, session_id: SESSION, plan_item_id, exercise_id: EX, exercise_name: 'Bench Press', set_no, position,
    target_reps: 5, target_weight: 100, actual_reps: 5, weight: 100, done: true, note: '', ...sync,
  })
  // stored out of order on purpose: without seq the display order falls back to (position, set_no)
  await old.table('setLogs').bulkAdd([
    log('00000000-0000-4000-8000-0000000000a4', NO_RULE, 1, 2),
    log('00000000-0000-4000-8000-0000000000a1', WITH_RULE, 0, 1),
    log('00000000-0000-4000-8000-0000000000a3', NO_RULE, 1, 1),
    log('00000000-0000-4000-8000-0000000000a2', WITH_RULE, 0, 2),
  ])
  old.close()
}

test('a v1 guest database upgrades with defaults, keeps rule meaning and stays usable', async () => {
  const name = `upgrade-${crypto.randomUUID()}`
  await writeV1(name)
  const db = new AppDb(name)
  const repo = new LocalRepo(db)
  await repo.init() // existing profile: no re-seed

  // the stored rows got the new fields
  expect(await db.planDays.get(DAY)).toMatchObject({ color: null })
  expect(await db.exercises.get(EX)).toMatchObject({ supports_angle: false, default_rule: null })
  expect(await db.planItems.get(NO_RULE)).toMatchObject({
    angle: null, amrap_last: false, superset_group: null, inherit_rule: false,
  })
  expect(await db.setLogs.get('00000000-0000-4000-8000-0000000000a1')).toMatchObject({
    angle: null, amrap: false, seq: null, superset_group: null, superset_label: null,
  })

  // an old rule row stays an override; an old missing row stays "no progression"
  const tree = await repo.getPlan(PLAN)
  const items = tree?.days[0]?.items ?? []
  expect(items.map((i) => [i.id, i.ruleSource, i.rule?.success_amount ?? null])).toEqual([
    [WITH_RULE, 'item', 10],
    [NO_RULE, 'item', null],
  ])

  // old history renders in (position, set_no) order
  const history = await repo.getSession(SESSION)
  expect(history?.exercises.map((e) => [e.plan_item_id, e.sets.map((s) => s.set_no)])).toEqual([
    [WITH_RULE, [1, 2]],
    [NO_RULE, [1, 2]],
  ])

  // and the upgraded database works with the new features
  await repo.clearRule(NO_RULE)
  expect((await repo.getPlan(PLAN))?.days[0]?.items[1]?.ruleSource).toBe('builtin')
  await repo.setSuperset(DAY, crypto.randomUUID(), [WITH_RULE, NO_RULE])
  const s = await repo.startSession(DAY)
  expect(s.exercises.flatMap((e) => e.sets).every((l) => l.seq !== null && l.superset_label !== null)).toBe(true)
  await db.delete()
})
