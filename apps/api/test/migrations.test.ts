import { describe, expect, it } from 'vitest'
import { runMigrations } from '../src/migrations.js'
import type { Db } from '../src/db/types.js'

describe('runMigrations', () => {
  it('throws instead of silently skipping when the migrations folder is missing', async () => {
    await expect(runMigrations({} as Db, '/nonexistent-migrations')).rejects.toThrow(/Migrations not found/)
  })
})

describe('migration 0001 (day colour, angle, AMRAP, supersets, layered rules)', () => {
  it('upgrades rows written by the previous release with defaults that keep their meaning', async () => {
    const { withTestDb } = await import('./harness.js')
    const { createService } = await import('../src/service/index.js')
    const t = await withTestDb({ upTo: 1 })
    try {
      const u = 'u_old_release'
      const ids = {
        ex: '00000000-0000-4000-8000-000000000002',
        plan: '00000000-0000-4000-8000-000000000003',
        day: '00000000-0000-4000-8000-000000000004',
        withRule: '00000000-0000-4000-8000-000000000005',
        noRule: '00000000-0000-4000-8000-000000000006',
        session: '00000000-0000-4000-8000-000000000007',
      }
      // Exactly the columns the 0000 schema had.
      await t.sql(`insert into "user" (id, name, email) values ('${u}', 'old', 'old@example.test')`)
      await t.sql(`insert into profile (user_id, weight_increment) values ('${u}', 5)`)
      await t.sql(`insert into exercise (id, user_id, name, default_sets, default_reps, default_weight)
        values ('${ids.ex}', '${u}', 'Bench Press', 2, 5, 100)`)
      await t.sql(`insert into plan (id, user_id, name) values ('${ids.plan}', '${u}', 'Old plan')`)
      await t.sql(`insert into plan_day (id, user_id, plan_id, name, position) values ('${ids.day}', '${u}', '${ids.plan}', 'Old day', 0)`)
      await t.sql(`insert into plan_item (id, user_id, plan_day_id, exercise_id, position) values
        ('${ids.withRule}', '${u}', '${ids.day}', '${ids.ex}', 0), ('${ids.noRule}', '${u}', '${ids.day}', '${ids.ex}', 1)`)
      await t.sql(`insert into progression_rule (user_id, plan_item_id, success_action, success_amount, fail_streak_limit, deload_pct)
        values ('${u}', '${ids.withRule}', 'add_weight', 10, 3, 10)`)
      await t.sql(`insert into workout_session (id, user_id, plan_day_id, plan_name, day_name, started_at, completed_at)
        values ('${ids.session}', '${u}', '${ids.day}', 'Old plan', 'Old day', now(), now())`)
      await t.sql(`insert into set_log (id, user_id, session_id, plan_item_id, exercise_id, exercise_name, set_no, position,
        target_reps, target_weight, actual_reps, weight, done) values
        ('00000000-0000-4000-8000-0000000000a2', '${u}', '${ids.session}', '${ids.noRule}', '${ids.ex}', 'Bench Press', 1, 1, 5, 100, 5, 100, true),
        ('00000000-0000-4000-8000-0000000000a1', '${u}', '${ids.session}', '${ids.withRule}', '${ids.ex}', 'Bench Press', 1, 0, 5, 100, 5, 100, true)`)

      await t.migrateRest()
      const repo = createService(t.db, u)
      const tree = await repo.getPlan(ids.plan)
      expect(tree?.days[0]?.color).toBeNull()
      expect(tree?.days[0]?.items[0]?.exercise).toMatchObject({ supports_angle: false, default_rule: null })
      // an old rule row stays an override; an old missing row stays "no progression"
      expect(tree?.days[0]?.items.map((i) => [i.id, i.ruleSource, i.rule?.success_amount ?? null, i.inherit_rule, i.angle, i.amrap_last, i.superset_group])).toEqual([
        [ids.withRule, 'item', 10, false, null, false, null],
        [ids.noRule, 'item', null, false, null, false, null],
      ])
      const history = await repo.getSession(ids.session)
      expect(history?.exercises.map((e) => e.plan_item_id)).toEqual([ids.withRule, ids.noRule])
      expect(history?.exercises[0]?.sets[0]).toMatchObject({ seq: null, amrap: false, angle: null, superset_group: null, superset_label: null })
      // the upgraded account round-trips through export
      expect((await repo.exportAll()).plan_items).toHaveLength(2)
    } finally {
      await t.cleanup()
    }
  })
})

describe('migration 0002 (community plans)', () => {
  it('loads profiles and plans written by the previous release with display_name and source null', async () => {
    const { withTestDb } = await import('./harness.js')
    const { createService } = await import('../src/service/index.js')
    const t = await withTestDb({ upTo: 2 })
    try {
      const u = 'u_before_community'
      const plan = '00000000-0000-4000-8000-000000000013'
      await t.sql(`insert into "user" (id, name, email) values ('${u}', 'old', 'old2@example.test')`)
      await t.sql(`insert into profile (user_id, weight_increment) values ('${u}', 5)`)
      await t.sql(`insert into plan (id, user_id, name) values ('${plan}', '${u}', 'Old plan')`)
      await t.migrateRest()
      const repo = createService(t.db, u)
      expect((await repo.getProfile()).display_name).toBeNull()
      expect(await repo.getPlan(plan)).toMatchObject({ source: null, published: null })
      expect((await repo.listPlans())[0]).toMatchObject({ source: null, published: null })
      expect(await repo.listMyShared()).toEqual([])
    } finally {
      await t.cleanup()
    }
  })
})

describe('migrations 0003/0004 (search columns)', () => {
  it('backfills search_text, no_gear and day_count of versions published before them', async () => {
    const { withTestDb } = await import('./harness.js')
    const { createPublicService } = await import('../src/service/community.js')
    const t = await withTestDb({ upTo: 3 })
    try {
      const u = 'u_before_search'
      const id = '00000000-0000-4000-8000-000000000021'
      const snapshot = JSON.stringify({
        name: 'Old', units: 'lb',
        days: [{ name: 'D', color: null, items: [{ exercise: 'Zercher Squat', gear: [], supports_angle: false, sets: 3, reps: 5, weight: 100, angle: null, amrap_last: false, superset: null, rule: null }] }],
      })
      await t.sql(`insert into "user" (id, name, email) values ('${u}', 'old', 'old3@example.test')`)
      await t.sql(`insert into profile (user_id, weight_increment, display_name) values ('${u}', 5, 'Old Timer')`)
      await t.sql(`insert into shared_plan (id, owner_id, title, latest_version) values ('${id}', '${u}', 'Legacy Title', 1)`)
      await t.sql(`insert into shared_plan_version (shared_plan_id, version, snapshot) values ('${id}', 1, '${snapshot}'::jsonb)`)
      await t.migrateRest()
      const pub = createPublicService(t.db)
      for (const q of ['zercher', 'legacy']) {
        const page = await pub.listPlans({ q, gear: 'none', days: 1, sort: 'top', limit: 20 })
        expect(page.items.map((l) => [l.id, l.day_count]), q).toEqual([[id, 1]])
      }
    } finally {
      await t.cleanup()
    }
  })
})

describe('migration 0005 (listing owner nullable)', () => {
  it('keeps listings written before it; deleting the owner afterwards keeps the listing with no owner', async () => {
    const { withTestDb } = await import('./harness.js')
    const { createPublicService } = await import('../src/service/community.js')
    const t = await withTestDb({ upTo: 5 })
    try {
      const u = 'u_before_owner_null'
      const id = '00000000-0000-4000-8000-000000000051'
      const snapshot = JSON.stringify({
        name: 'Old', units: 'lb',
        days: [{ name: 'D', color: null, items: [{ exercise: 'Goblet Squat', gear: [], supports_angle: false, sets: 3, reps: 5, weight: 50, angle: null, amrap_last: false, superset: null, rule: null }] }],
      })
      await t.sql(`insert into "user" (id, name, email) values ('${u}', 'old', 'old5@example.test')`)
      await t.sql(`insert into profile (user_id, weight_increment, display_name) values ('${u}', 5, 'Old Owner')`)
      await t.sql(`insert into shared_plan (id, owner_id, title, latest_version) values ('${id}', '${u}', 'Before Null', 1)`)
      await t.sql(`insert into shared_plan_version (shared_plan_id, version, snapshot, day_count) values ('${id}', 1, '${snapshot}'::jsonb, 1)`)
      await t.migrateRest()
      const pub = createPublicService(t.db)
      expect((await pub.getPlan(id))?.listing.author).toBe('Old Owner')
      await t.sql(`delete from "user" where id = '${u}'`)
      expect(await t.sql(`select owner_id from shared_plan where id = '${id}'`)).toEqual([{ owner_id: null }])
      expect((await pub.getPlan(id))?.listing.author).toBe('Deleted user')
    } finally {
      await t.cleanup()
    }
  })
})
