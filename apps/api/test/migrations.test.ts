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
