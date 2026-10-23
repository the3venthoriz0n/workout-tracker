/**
 * Behavioral contract for every `Repo` implementation (LocalRepo, the server service layer, ApiRepo).
 * Expectations come from docs/spec.md §5 and §6 and go through the `Repo` interface only.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { defaultRule } from '../progression.js'
import { SessionInProgressError } from '../repo.js'
import type { ExportData, PlanTree, Repo, SessionDetail } from '../repo.js'
import type { Exercise, PlanItem, RuleInput } from '../schemas.js'
import { newId } from '../id.js'

export type RepoHarness = {
  repo: Repo
  cleanup(): Promise<void>
  /**
   * Loads exported data into this harness's account as a first-time import (ids kept, owner rewritten).
   * Leave undefined when the implementation has no import; the transfer case is then skipped.
   */
  importAll?: (data: ExportData) => Promise<void>
}

export type ContractGroup =
  | 'profile'
  | 'gear'
  | 'exercises'
  | 'plans'
  | 'progression'
  | 'sessions'
  | 'transfer'

/** `empty`: the account must NOT be initialised (no profile, no seeds); used for the import target. */
export type MakeOptions = { empty?: boolean }

type Ctx = { repo: Repo; h: RepoHarness; make: (opts?: MakeOptions) => Promise<RepoHarness>; skip: () => void }

function must<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) throw new Error(`contract setup: ${what} missing`)
  return value
}

const rule = (patch: Partial<RuleInput> = {}): RuleInput => ({ ...defaultRule(5), ...patch })

async function exercise(repo: Repo, name: string): Promise<Exercise> {
  return must((await repo.listExercises()).find((e) => e.name === name), `seed exercise ${name}`)
}

async function planWithDay(repo: Repo, planName = 'Plan', dayName = 'Day') {
  const plan = await repo.savePlan({ name: planName })
  const day = await repo.savePlanDay({ plan_id: plan.id, name: dayName })
  return { plan, day }
}

async function tree(repo: Repo, planId: string): Promise<PlanTree> {
  return must(await repo.getPlan(planId), 'plan')
}

async function planItem(repo: Repo, planId: string, itemId: string) {
  const t = await tree(repo, planId)
  return must(t.days.flatMap((d) => d.items).find((i) => i.id === itemId), 'plan item')
}

async function failStreak(repo: Repo, itemId: string): Promise<number | undefined> {
  return (await repo.exportAll()).item_states.find((s) => s.plan_item_id === itemId && s.deleted_at === null)
    ?.fail_streak
}

function setsOf(session: SessionDetail, itemId: string) {
  return must(session.exercises.find((e) => e.plan_item_id === itemId), 'session exercise').sets
}

async function markDone(repo: Repo, session: SessionDetail, itemId: string, count?: number, reps?: number) {
  for (const s of setsOf(session, itemId).slice(0, count)) {
    await repo.updateSet(s.id, { done: true, ...(reps === undefined ? {} : { actual_reps: reps }) })
  }
}

/** Spin (no timers) until the wall clock is past `iso`, so a later server/client timestamp is strictly newer. */
async function pastInstant(iso: string): Promise<void> {
  const limit = Date.parse(iso)
  for (let i = 0; Date.now() <= limit; i++) {
    if (i > 50_000_000) throw new Error('clock did not advance')
    await Promise.resolve()
  }
}

/** Order-independent, owner-independent view of an export for equality checks. */
function normalise(data: ExportData) {
  const strip = (rows: object[], key: string) =>
    rows
      .map((r) => ({ ...r, user_id: undefined }) as Record<string, unknown>)
      .sort((a, b) => String(a[key]).localeCompare(String(b[key])))
  return {
    version: data.version,
    profile: { ...data.profile, user_id: undefined },
    gear: strip(data.gear, 'id'),
    exercises: strip(data.exercises, 'id'),
    plans: strip(data.plans, 'id'),
    plan_days: strip(data.plan_days, 'id'),
    plan_items: strip(data.plan_items, 'id'),
    progression_rules: strip(data.progression_rules, 'plan_item_id'),
    item_states: strip(data.item_states, 'plan_item_id'),
    workout_sessions: strip(data.workout_sessions, 'id'),
    set_logs: strip(data.set_logs, 'id'),
  }
}

export function runRepoContract(
  label: string,
  make: (opts?: MakeOptions) => Promise<RepoHarness>,
  // `pending`: exact titles of cases that need methods the harness has not implemented yet
  // (reported as skipped, not silently dropped). Remove entries as the methods land.
  opts?: { groups?: ContractGroup[]; pending?: string[] },
): void {
  const pending = new Set(opts?.pending ?? [])
  const enabled = new Set<ContractGroup>(
    opts?.groups ?? ['profile', 'gear', 'exercises', 'plans', 'progression', 'sessions', 'transfer'],
  )

  describe(label, () => {
    const live: RepoHarness[] = []
    const fresh = async (opts?: MakeOptions) => {
      const h = await make(opts)
      live.push(h)
      return h
    }
    afterEach(async () => {
      const all = live.splice(0)
      for (const h of all.reverse()) await h.cleanup()
    })

    const contract = (group: ContractGroup, title: string, body: (c: Ctx) => Promise<void>) => {
      if (!enabled.has(group)) return
      const register = pending.has(title) ? it.skip : it
      register(title, async (t) => {
        const h = await fresh()
        await body({ repo: h.repo, h, make: fresh, skip: () => t.skip() })
      })
    }

    // ---------------------------------------------------------------- profile
    contract('profile', 'init is idempotent and seeds 8 gear and 16 exercises', async ({ repo }) => {
      await repo.init()
      await repo.init()
      const profile = await repo.getProfile()
      expect(profile).toMatchObject({ plan: 'free', units: 'lb', weight_increment: 5 })
      expect(profile.default_rule).toBeUndefined()
      const gear = await repo.listGear()
      const exercises = await repo.listExercises()
      expect(gear).toHaveLength(8)
      expect(exercises).toHaveLength(16)
      expect(gear.every((g) => g.owned)).toBe(true)
      // seeded exercises only reference seeded gear
      const gearIds = new Set(gear.map((g) => g.id))
      for (const e of exercises) for (const id of e.required_gear_ids) expect(gearIds.has(id)).toBe(true)
      await repo.init()
      expect((await repo.getProfile()).user_id).toBe(profile.user_id)
      expect(await repo.listGear()).toHaveLength(8)
      expect(await repo.listExercises()).toHaveLength(16)
    })

    contract(
      'profile',
      'unit switch converts exercise defaults, item weights/targets, set-log weights and add_weight rule amounts, and resets the step',
      async ({ repo }) => {
        const bench = await exercise(repo, 'Bench Press')
        const squat = await exercise(repo, 'Back Squat')
        await repo.saveExercise({ ...bench, default_weight: 135 })
        const { plan, day } = await planWithDay(repo)
        const a = await repo.addPlanItem(day.id, bench.id) // default rule: add_weight by the step (5 lb)
        await repo.updatePlanItem(a.id, { sets: 1, reps: 5, weight: 135 })
        const b = await repo.addPlanItem(day.id, squat.id)
        await repo.setRule(b.id, rule({ success_amount: 10 }))
        const c = await repo.addPlanItem(day.id, (await exercise(repo, 'Deadlift')).id)
        await repo.setRule(c.id, rule({ success_action: 'add_reps', success_amount: 1, rep_ceiling: 12 }))

        // finishing a fully-done set moves the item target 135 -> 140; the set log keeps 135/135
        const session = await repo.startSession(day.id)
        await markDone(repo, session, a.id)
        await repo.finishSession(session.id)
        const before = await planItem(repo, plan.id, a.id)
        expect(before).toMatchObject({ weight: 135, target_weight: 140 })

        const profile = await repo.updateProfile({ units: 'kg' })
        expect(profile).toMatchObject({ units: 'kg', weight_increment: 2.5 })

        expect((await exercise(repo, 'Bench Press')).default_weight).toBe(61.2)
        const after = await planItem(repo, plan.id, a.id)
        expect(after.weight).toBe(61.2)
        expect(after.target_weight).toBe(63.5)
        expect(after.rule?.success_amount).toBe(2.5) // equal to the old step -> the new unit's step
        expect((await planItem(repo, plan.id, b.id)).rule?.success_amount).toBe(5) // 10 lb = 4.5 kg -> nearest 2.5
        expect((await planItem(repo, plan.id, c.id)).rule?.success_amount).toBe(1) // add_reps is not a weight
        const log = must((await repo.getSession(session.id)), 'session').exercises[0]?.sets[0]
        expect(log).toMatchObject({ weight: 61.2, target_weight: 61.2 })

        // same unit again changes nothing
        await repo.updateProfile({ units: 'kg' })
        expect((await exercise(repo, 'Bench Press')).default_weight).toBe(61.2)
        expect((await planItem(repo, plan.id, a.id)).target_weight).toBe(63.5)

        // the step is reset by every unit change, even after a custom value
        await repo.updateProfile({ weight_increment: 1.25 })
        expect((await repo.getProfile()).weight_increment).toBe(1.25)
        expect(await repo.updateProfile({ units: 'lb' })).toMatchObject({ units: 'lb', weight_increment: 5 })
      },
    )

    // ------------------------------------------------------------------- gear
    contract('gear', 'saveGear renames and keeps the id; listGear is sorted by name', async ({ repo }) => {
      const created = await repo.saveGear({ name: 'Zzz sled', owned: true })
      expect(created).toMatchObject({ name: 'Zzz sled', owned: true })
      const renamed = await repo.saveGear({ id: created.id, name: 'Aaa sled', owned: false })
      expect(renamed).toMatchObject({ id: created.id, name: 'Aaa sled', owned: false })
      const list = await repo.listGear()
      expect(list).toHaveLength(9)
      expect(list.filter((g) => g.id === created.id)).toHaveLength(1)
      expect(list.some((g) => g.name === 'Zzz sled')).toBe(false)
      const names = list.map((g) => g.name)
      expect(names[0]).toBe('Aaa sled')
      const at = (name: string) => names.indexOf(name)
      expect(at('Barbell')).toBeGreaterThan(-1)
      expect(at('Barbell')).toBeLessThan(at('Bench'))
      expect(at('Bench')).toBeLessThan(at('Cable machine'))
      expect(at('Cable machine')).toBeLessThan(at('Dumbbells'))
      expect(at('Dumbbells')).toBeLessThan(at('Kettlebell'))
      const late = await repo.saveGear({ name: 'Zzzz late', owned: true })
      expect((await repo.listGear()).at(-1)?.id).toBe(late.id)
    })

    contract(
      'gear',
      "deleteGear removes the id from live exercises' required gear",
      async ({ repo }) => {
        const gear = await repo.listGear()
        const barbell = must(gear.find((g) => g.name === 'Barbell'), 'Barbell')
        const bench = must(gear.find((g) => g.name === 'Bench'), 'Bench')
        const press = await exercise(repo, 'Bench Press')
        expect(press.required_gear_ids).toEqual(expect.arrayContaining([barbell.id, bench.id]))
        const custom = await repo.saveExercise({
          name: 'Custom lift',
          notes: '',
          video_url: null,
          required_gear_ids: [barbell.id],
          active: true,
          default_sets: 3,
          default_reps: 5,
          default_weight: 45,
        })

        await repo.deleteGear(barbell.id)

        expect((await repo.listGear()).some((g) => g.id === barbell.id)).toBe(false)
        const exercises = await repo.listExercises()
        expect(exercises.some((e) => e.required_gear_ids.includes(barbell.id))).toBe(false)
        expect(must(exercises.find((e) => e.id === press.id), 'press').required_gear_ids).toEqual([bench.id])
        expect(must(exercises.find((e) => e.id === custom.id), 'custom').required_gear_ids).toEqual([])
        expect(await repo.listGear()).toHaveLength(7)
        expect(exercises).toHaveLength(17)
      },
    )

    // -------------------------------------------------------------- exercises
    contract(
      'exercises',
      'deleteExercise cascades to its live plan items and keeps history names',
      async ({ repo }) => {
        const bench = await exercise(repo, 'Bench Press')
        const squat = await exercise(repo, 'Back Squat')
        const { plan, day } = await planWithDay(repo)
        const benchItem = await repo.addPlanItem(day.id, bench.id)
        const squatItem = await repo.addPlanItem(day.id, squat.id)
        const session = await repo.startSession(day.id)
        await markDone(repo, session, benchItem.id)
        await repo.finishSession(session.id)

        await repo.deleteExercise(bench.id)

        expect((await repo.listExercises()).some((e) => e.id === bench.id)).toBe(false)
        const days = (await tree(repo, plan.id)).days
        expect(days[0]?.items.map((i) => i.id)).toEqual([squatItem.id])
        expect((await repo.listProgression()).map((r) => r.item_id)).toEqual([squatItem.id])
        expect(await repo.exerciseUsage(bench.id)).toEqual({ planItemCount: 0, plans: [] })
        expect((await repo.exerciseUsage(squat.id)).planItemCount).toBe(1)
        // history keeps the name it was logged under
        const history = must(await repo.getSession(session.id), 'session')
        expect(history.exercises.map((e) => e.exercise_name)).toEqual(['Bench Press', 'Back Squat'])
        // a new session no longer includes the deleted exercise
        const next = await repo.startSession(day.id)
        expect(next.exercises.map((e) => e.plan_item_id)).toEqual([squatItem.id])
      },
    )

    contract(
      'exercises',
      'exerciseUsage counts live items and distinct live plan names',
      async ({ repo }) => {
        const bench = await exercise(repo, 'Bench Press')
        expect(await repo.exerciseUsage(bench.id)).toEqual({ planItemCount: 0, plans: [] })

        const alpha = await repo.savePlan({ name: 'Alpha' })
        const alphaA = await repo.savePlanDay({ plan_id: alpha.id, name: 'A' })
        const alphaB = await repo.savePlanDay({ plan_id: alpha.id, name: 'B' })
        const beta = await repo.savePlan({ name: 'Beta' })
        const betaDay = await repo.savePlanDay({ plan_id: beta.id, name: 'C' })
        await repo.addPlanItem(alphaA.id, bench.id)
        await repo.addPlanItem(alphaB.id, bench.id)
        await repo.addPlanItem(betaDay.id, bench.id)
        const removed = await repo.addPlanItem(betaDay.id, bench.id)
        await repo.deletePlanItem(removed.id)

        expect(await repo.exerciseUsage(bench.id)).toEqual({ planItemCount: 3, plans: ['Alpha', 'Beta'] })

        await repo.deletePlanDay(alphaB.id)
        expect(await repo.exerciseUsage(bench.id)).toEqual({ planItemCount: 2, plans: ['Alpha', 'Beta'] })

        await repo.deletePlan(beta.id)
        expect(await repo.exerciseUsage(bench.id)).toEqual({ planItemCount: 1, plans: ['Alpha'] })
      },
    )

    // ------------------------------------------------------------------ plans
    contract('plans', 'getPlan sorts days and items by position and move swaps neighbours', async ({ repo }) => {
      expect(await repo.getPlan(newId())).toBeUndefined()
      const plan = await repo.savePlan({ name: 'PPL' })
      const d1 = await repo.savePlanDay({ plan_id: plan.id, name: 'One' })
      const d2 = await repo.savePlanDay({ plan_id: plan.id, name: 'Two' })
      const d3 = await repo.savePlanDay({ plan_id: plan.id, name: 'Three' })
      const ex = await repo.listExercises()
      const i1 = await repo.addPlanItem(d1.id, must(ex[0], 'exercise').id)
      const i2 = await repo.addPlanItem(d1.id, must(ex[1], 'exercise').id)
      const i3 = await repo.addPlanItem(d1.id, must(ex[2], 'exercise').id)

      const dayIds = async () => (await tree(repo, plan.id)).days.map((d) => d.id)
      const itemIds = async () => (await tree(repo, plan.id)).days.find((d) => d.id === d1.id)?.items.map((i) => i.id)

      expect(await dayIds()).toEqual([d1.id, d2.id, d3.id])
      expect(await itemIds()).toEqual([i1.id, i2.id, i3.id])
      const first = must((await tree(repo, plan.id)).days[0]?.items[0], 'item')
      expect(first.exercise.id).toBe(must(ex[0], 'exercise').id)
      expect(first.effective).toMatchObject({
        sets: first.exercise.default_sets,
        baseReps: first.exercise.default_reps,
        baseWeight: first.exercise.default_weight,
        targetReps: first.exercise.default_reps,
        targetWeight: first.exercise.default_weight,
      })
      expect((await tree(repo, plan.id)).days[1]?.items).toEqual([])

      await repo.move('day', d3.id, -1)
      expect(await dayIds()).toEqual([d1.id, d3.id, d2.id])
      await repo.move('day', d1.id, 1)
      expect(await dayIds()).toEqual([d3.id, d1.id, d2.id])
      await repo.move('day', d3.id, -1) // already first: no-op
      await repo.move('day', d2.id, 1) // already last: no-op
      expect(await dayIds()).toEqual([d3.id, d1.id, d2.id])

      await repo.move('item', i1.id, 1)
      expect(await itemIds()).toEqual([i2.id, i1.id, i3.id])
      await repo.move('item', i3.id, -1)
      expect(await itemIds()).toEqual([i2.id, i3.id, i1.id])
      await repo.move('item', i2.id, -1) // first: no-op
      expect(await itemIds()).toEqual([i2.id, i3.id, i1.id])

      // deleted days and items disappear and no longer count as neighbours
      await repo.deletePlanItem(i3.id)
      await repo.move('item', i1.id, -1)
      expect(await itemIds()).toEqual([i1.id, i2.id])
      await repo.deletePlanDay(d1.id)
      expect(await dayIds()).toEqual([d3.id, d2.id])
    })

    contract('plans', 'addPlanItem uses default_rule when set, else the default rule', async ({ repo }) => {
      const ex = await repo.listExercises()
      const { plan, day } = await planWithDay(repo)
      const first = await repo.addPlanItem(day.id, must(ex[0], 'exercise').id)
      expect(first).toMatchObject({ sets: null, reps: null, weight: null, target_reps: null, target_weight: null })
      expect((await planItem(repo, plan.id, first.id)).rule).toMatchObject(defaultRule(5))
      expect(await failStreak(repo, first.id)).toBe(0)

      const custom = rule({ success_amount: 10, fail_streak_limit: 2, deload_pct: 20 })
      await repo.updateProfile({ default_rule: custom })
      expect((await repo.getProfile()).default_rule).toEqual(custom)
      const second = await repo.addPlanItem(day.id, must(ex[1], 'exercise').id)
      expect(second.position).toBeGreaterThan(first.position)
      expect((await planItem(repo, plan.id, second.id)).rule).toMatchObject(custom)
      // existing items keep the rule they started with
      expect((await planItem(repo, plan.id, first.id)).rule).toMatchObject(defaultRule(5))

      // a unit change converts the stored default (10 lb -> 4.5 kg -> nearest 2.5) and new items use it
      await repo.updateProfile({ units: 'kg' })
      expect((await repo.getProfile()).default_rule).toMatchObject({ ...custom, success_amount: 5 })
      const third = await repo.addPlanItem(day.id, must(ex[2], 'exercise').id)
      expect((await planItem(repo, plan.id, third.id)).rule).toMatchObject({ ...custom, success_amount: 5 })
    })

    contract(
      'plans',
      "editing an item's reps or weight clears targets and the fail streak",
      async ({ repo }) => {
        const bench = await exercise(repo, 'Bench Press')
        const { plan, day } = await planWithDay(repo)
        const item = await repo.addPlanItem(day.id, bench.id)
        await repo.updatePlanItem(item.id, { sets: 1 })

        // session 1: success -> target 100; session 2: a miss -> streak 1
        const s1 = await repo.startSession(day.id)
        await markDone(repo, s1, item.id)
        await repo.finishSession(s1.id)
        const s2 = await repo.startSession(day.id)
        await markDone(repo, s2, item.id, undefined, 4)
        await repo.finishSession(s2.id)
        expect(await planItem(repo, plan.id, item.id)).toMatchObject({ target_reps: 5, target_weight: 100 })
        expect(await failStreak(repo, item.id)).toBe(1)

        // sets is not reps/weight: targets and streak stay
        await repo.updatePlanItem(item.id, { sets: 2 })
        expect(await planItem(repo, plan.id, item.id)).toMatchObject({ sets: 2, target_reps: 5, target_weight: 100 })
        expect(await failStreak(repo, item.id)).toBe(1)

        const edited = await repo.updatePlanItem(item.id, { reps: 6 })
        expect(edited).toMatchObject({ reps: 6, target_reps: null, target_weight: null })
        const reloaded = await planItem(repo, plan.id, item.id)
        expect(reloaded).toMatchObject({ reps: 6, target_reps: null, target_weight: null })
        expect(reloaded.effective).toMatchObject({ targetReps: 6, targetWeight: bench.default_weight })
        expect(await failStreak(repo, item.id)).toBe(0)

        // the same holds for a weight edit
        const s3 = await repo.startSession(day.id)
        await markDone(repo, s3, item.id, 1)
        await repo.finishSession(s3.id) // 1 of 2 planned sets -> miss
        expect(await failStreak(repo, item.id)).toBe(1)
        await repo.updatePlanItem(item.id, { weight: 50 })
        expect(await planItem(repo, plan.id, item.id)).toMatchObject({ weight: 50, target_reps: null, target_weight: null })
        expect(await failStreak(repo, item.id)).toBe(0)
      },
    )

    contract('plans', 'setRule(null) removes the rule', async ({ repo }) => {
      const { plan, day } = await planWithDay(repo)
      const item = await repo.addPlanItem(day.id, (await exercise(repo, 'Deadlift')).id)
      expect((await planItem(repo, plan.id, item.id)).rule).not.toBeNull()

      await repo.setRule(item.id, null)
      expect((await planItem(repo, plan.id, item.id)).rule).toBeNull()
      expect((await repo.listProgression()).find((r) => r.item_id === item.id)?.rule).toBeNull()
      await repo.setRule(item.id, null) // removing twice is fine

      const custom = rule({ success_action: 'add_reps', success_amount: 2, rep_ceiling: 12, deload_pct: 15 })
      await repo.setRule(item.id, custom)
      expect((await planItem(repo, plan.id, item.id)).rule).toMatchObject(custom)
      await repo.setRule(item.id, rule({ success_amount: 15 }))
      expect((await planItem(repo, plan.id, item.id)).rule).toMatchObject(rule({ success_amount: 15 }))
      await expect(repo.setRule(item.id, rule({ success_amount: 0 }))).rejects.toThrow()
    })

    // ------------------------------------------------------------ progression
    contract('progression', 'listProgression is ordered and skips deleted items', async ({ repo }) => {
      const [ex1, ex2] = await repo.listExercises()
      const e1 = must(ex1, 'exercise')
      const e2 = must(ex2, 'exercise')
      expect(await repo.listProgression()).toEqual([])
      const p1 = await repo.savePlan({ name: 'One' })
      const p2 = await repo.savePlan({ name: 'Two' })
      const d1 = await repo.savePlanDay({ plan_id: p1.id, name: 'A' })
      const d2 = await repo.savePlanDay({ plan_id: p1.id, name: 'B' })
      const d3 = await repo.savePlanDay({ plan_id: p2.id, name: 'C' })
      const i1 = await repo.addPlanItem(d1.id, e1.id)
      const i2 = await repo.addPlanItem(d1.id, e2.id)
      const i3 = await repo.addPlanItem(d2.id, e1.id)
      const i4 = await repo.addPlanItem(d3.id, e2.id)
      await repo.setRule(i2.id, null)

      const rows = await repo.listProgression()
      expect(rows.map((r) => r.item_id)).toEqual([i1.id, i2.id, i3.id, i4.id])
      expect(rows[0]).toMatchObject({
        plan_id: p1.id,
        plan_name: 'One',
        day_id: d1.id,
        day_name: 'A',
        exercise_name: e1.name,
      })
      expect(rows[0]?.rule).toMatchObject(defaultRule(5))
      expect(rows[1]?.rule).toBeNull()

      await repo.move('item', i2.id, -1)
      expect((await repo.listProgression()).map((r) => r.item_id)).toEqual([i2.id, i1.id, i3.id, i4.id])

      const gone = await repo.addPlanItem(d1.id, e1.id)
      await repo.deletePlanItem(gone.id)
      await repo.deletePlanDay(d2.id)
      expect((await repo.listProgression()).map((r) => r.item_id)).toEqual([i2.id, i1.id, i4.id])
      await repo.deletePlan(p2.id)
      expect((await repo.listProgression()).map((r) => r.item_id)).toEqual([i2.id, i1.id])
      await repo.deleteExercise(e2.id)
      expect((await repo.listProgression()).map((r) => r.item_id)).toEqual([i1.id])
    })

    // --------------------------------------------------------------- sessions
    contract(
      'sessions',
      'startSession pre-fills sets from effective targets and rejects a second active session',
      async ({ repo }) => {
        const bench = await exercise(repo, 'Bench Press')
        const squat = await exercise(repo, 'Back Squat')
        await repo.saveExercise({ ...squat, default_sets: 2, default_reps: 8, default_weight: 20 })
        const { plan, day } = await planWithDay(repo, 'PPL', 'Push')
        const a = await repo.addPlanItem(day.id, bench.id)
        await repo.updatePlanItem(a.id, { sets: 3, reps: 5, weight: 95 })
        const b = await repo.addPlanItem(day.id, squat.id)

        expect(await repo.getActiveSession()).toBeUndefined()
        const session = await repo.startSession(day.id)
        expect(session).toMatchObject({ plan_name: 'PPL', day_name: 'Push', completed_at: null, note: '', plan_day_id: day.id })
        expect(session.exercises.map((e) => [e.plan_item_id, e.exercise_name])).toEqual([
          [a.id, 'Bench Press'],
          [b.id, 'Back Squat'],
        ])
        const benchSets = setsOf(session, a.id)
        expect(benchSets).toHaveLength(3)
        for (const [i, s] of benchSets.entries()) {
          expect(s).toMatchObject({
            set_no: i + 1,
            target_reps: 5,
            target_weight: 95,
            actual_reps: 5,
            weight: 95,
            done: false,
            exercise_name: 'Bench Press',
          })
        }
        const squatSets = setsOf(session, b.id)
        expect(squatSets).toHaveLength(2)
        expect(squatSets[0]).toMatchObject({ target_reps: 8, target_weight: 20, actual_reps: 8, weight: 20, done: false })

        expect((await repo.getActiveSession())?.id).toBe(session.id)
        await expect(repo.startSession(day.id)).rejects.toBeInstanceOf(SessionInProgressError)
        expect((await repo.getActiveSession())?.id).toBe(session.id)

        // names are snapshots
        await repo.savePlan({ id: plan.id, name: 'Renamed' })
        expect((await repo.getActiveSession())?.plan_name).toBe('PPL')

        // after discarding, a new session is allowed and pre-fills from the progressed target
        await repo.discardSession(session.id)
        await expect(repo.startSession(newId())).rejects.toThrow()
        await repo.updatePlanItem(a.id, { sets: 1 })
        const s2 = await repo.startSession(day.id)
        await markDone(repo, s2, a.id)
        await repo.finishSession(s2.id)
        const s3 = await repo.startSession(day.id)
        expect(setsOf(s3, a.id)).toHaveLength(1)
        expect(setsOf(s3, a.id)[0]).toMatchObject({ target_reps: 5, target_weight: 100, actual_reps: 5, weight: 100 })
      },
    )

    contract('sessions', 'updateSet validates and merges only defined keys', async ({ repo }) => {
      const { day } = await planWithDay(repo)
      const item = await repo.addPlanItem(day.id, (await exercise(repo, 'Bench Press')).id)
      await repo.updatePlanItem(item.id, { sets: 2, reps: 5, weight: 95 })
      const session = await repo.startSession(day.id)
      const [first, second] = setsOf(session, item.id)
      const set = must(first, 'set')

      const merged = await repo.updateSet(set.id, { done: undefined, actual_reps: 4 })
      expect(merged).toMatchObject({ id: set.id, done: false, actual_reps: 4, weight: 95, note: '' })

      const full = await repo.updateSet(set.id, { done: true, actual_reps: 3, weight: 90, note: 'grindy' })
      expect(full).toMatchObject({ done: true, actual_reps: 3, weight: 90, note: 'grindy' })
      const partial = await repo.updateSet(set.id, { note: 'better' })
      expect(partial).toMatchObject({ done: true, actual_reps: 3, weight: 90, note: 'better' })

      await expect(repo.updateSet(set.id, { actual_reps: -1 })).rejects.toThrow()
      await expect(repo.updateSet(set.id, { actual_reps: 1.5 })).rejects.toThrow()
      await expect(repo.updateSet(set.id, { weight: -5 })).rejects.toThrow()
      await expect(repo.updateSet(newId(), { done: true })).rejects.toThrow()

      // failed updates and edits to one set leave the others and the stored values alone
      const stored = setsOf(must(await repo.getSession(session.id), 'session'), item.id)
      expect(stored[0]).toMatchObject({ done: true, actual_reps: 3, weight: 90, note: 'better' })
      expect(stored[1]).toMatchObject({ id: must(second, 'set').id, done: false, actual_reps: 5, weight: 95 })

      await repo.updateSessionNote(session.id, 'good day')
      expect((await repo.getSession(session.id))?.note).toBe('good day')
    })

    contract(
      'sessions',
      'finishSession: success adds the step and rounds to it, never by less than one step; miss increments the streak; deload at the limit; no rule or no sets done leaves targets untouched; deleted items are skipped',
      async ({ repo }) => {
        const names = [
          'Back Squat',
          'Bench Press',
          'Deadlift',
          'Overhead Press',
          'Barbell Row',
          'Romanian Deadlift',
          'Dumbbell Row',
          'Goblet Squat',
          'Pull-up',
          'Push-up',
        ]
        const { plan, day } = await planWithDay(repo)
        const items: Record<string, PlanItem> = {}
        for (const name of names) {
          const item = await repo.addPlanItem(day.id, (await exercise(repo, name)).id)
          await repo.updatePlanItem(item.id, { sets: 1, reps: 5, weight: 100 })
          items[name] = item
        }
        const id = (name: string) => must(items[name], name).id
        await repo.setRule(id('Back Squat'), rule({ success_amount: 7 })) // 107 -> 105
        await repo.setRule(id('Bench Press'), rule({ success_amount: 2 })) // 102 -> 100, bumped to one step: 105
        await repo.setRule(id('Deadlift'), rule({ fail_streak_limit: 3 })) // miss
        await repo.setRule(id('Overhead Press'), rule({ fail_streak_limit: 1, deload_pct: 10 })) // miss -> deload
        await repo.setRule(id('Barbell Row'), null) // no rule
        // Romanian Deadlift keeps the default rule but no set is done
        await repo.setRule(
          id('Dumbbell Row'),
          rule({ success_action: 'add_reps', success_amount: 1, rep_ceiling: 5 }),
        ) // 6 > ceiling 5: reps back to base, +1 step
        await repo.updatePlanItem(id('Goblet Squat'), { sets: 2 }) // only 1 of 2 sets done -> miss
        // Pull-up: deleted after the session starts
        // Push-up: success with add_reps and room under the ceiling
        await repo.setRule(id('Push-up'), rule({ success_action: 'add_reps', success_amount: 1, rep_ceiling: 8 }))

        const session = await repo.startSession(day.id)
        await markDone(repo, session, id('Back Squat'))
        await markDone(repo, session, id('Bench Press'))
        await markDone(repo, session, id('Deadlift'), undefined, 4)
        await markDone(repo, session, id('Overhead Press'), undefined, 4)
        await markDone(repo, session, id('Barbell Row'))
        await markDone(repo, session, id('Dumbbell Row'))
        await markDone(repo, session, id('Goblet Squat'), 1)
        await markDone(repo, session, id('Pull-up'))
        await markDone(repo, session, id('Push-up'))
        await repo.deletePlanItem(id('Pull-up'))

        const summary = await repo.finishSession(session.id)
        expect(summary.map((r) => r.exercise_name)).toEqual(names)
        const row = (name: string) => must(summary.find((r) => r.exercise_name === name), name)
        const at = (reps: number, weight: number) => ({ reps, weight })

        expect(row('Back Squat')).toMatchObject({ outcome: 'success', before: at(5, 100), after: at(5, 105) })
        expect(row('Bench Press')).toMatchObject({ outcome: 'success', before: at(5, 100), after: at(5, 105) })
        expect(row('Deadlift')).toMatchObject({ outcome: 'miss', before: at(5, 100), after: at(5, 100) })
        expect(row('Overhead Press')).toMatchObject({ outcome: 'deload', before: at(5, 100), after: at(5, 90) })
        expect(row('Barbell Row')).toMatchObject({ outcome: 'skipped', before: at(5, 100), after: at(5, 100) })
        expect(row('Romanian Deadlift')).toMatchObject({ outcome: 'skipped', after: at(5, 100) })
        expect(row('Dumbbell Row')).toMatchObject({ outcome: 'success', before: at(5, 100), after: at(5, 105) })
        expect(row('Goblet Squat')).toMatchObject({ outcome: 'miss', after: at(5, 100) })
        expect(row('Pull-up')).toMatchObject({ outcome: 'skipped', before: at(5, 100), after: at(5, 100) })
        expect(row('Push-up')).toMatchObject({ outcome: 'success', before: at(5, 100), after: at(6, 100) })

        // persisted targets and streaks
        const targets = async (name: string) => {
          const i = await planItem(repo, plan.id, id(name))
          return [i.target_reps, i.target_weight]
        }
        expect(await targets('Back Squat')).toEqual([5, 105])
        expect(await targets('Bench Press')).toEqual([5, 105])
        expect(await targets('Deadlift')).toEqual([5, 100])
        expect(await targets('Overhead Press')).toEqual([5, 90])
        expect(await targets('Dumbbell Row')).toEqual([5, 105])
        expect(await targets('Push-up')).toEqual([6, 100])
        // skipped items write nothing
        expect(await targets('Barbell Row')).toEqual([null, null])
        expect(await targets('Romanian Deadlift')).toEqual([null, null])
        expect(await failStreak(repo, id('Back Squat'))).toBe(0)
        expect(await failStreak(repo, id('Deadlift'))).toBe(1)
        expect(await failStreak(repo, id('Goblet Squat'))).toBe(1)
        expect(await failStreak(repo, id('Overhead Press'))).toBe(0)
        expect(await failStreak(repo, id('Barbell Row'))).toBe(0)

        // the session is complete and the progressed targets pre-fill the next one
        expect(await repo.getActiveSession()).toBeUndefined()
        expect((await repo.getSession(session.id))?.completed_at).not.toBeNull()
        await expect(repo.finishSession(session.id)).rejects.toThrow()
        const next = await repo.startSession(day.id)
        expect(setsOf(next, id('Back Squat'))[0]).toMatchObject({ target_reps: 5, target_weight: 105, weight: 105 })
        expect(setsOf(next, id('Overhead Press'))[0]).toMatchObject({ target_weight: 90 })
        expect(next.exercises.some((e) => e.plan_item_id === id('Pull-up'))).toBe(false)

        // a second miss on Deadlift (limit 3) and a miss after the streak builds up to a deload
        await markDone(repo, next, id('Deadlift'), undefined, 4)
        await repo.finishSession(next.id)
        expect(await failStreak(repo, id('Deadlift'))).toBe(2)
        const third = await repo.startSession(day.id)
        await markDone(repo, third, id('Deadlift'), undefined, 4)
        const summary3 = await repo.finishSession(third.id)
        expect(summary3.find((r) => r.exercise_name === 'Deadlift')).toMatchObject({
          outcome: 'deload',
          after: at(5, 90),
        })
        expect(await failStreak(repo, id('Deadlift'))).toBe(0)
      },
    )

    contract('sessions', 'discardSession removes an unfinished session and rejects a finished one', async ({ repo }) => {
      const { day } = await planWithDay(repo)
      await repo.addPlanItem(day.id, (await exercise(repo, 'Bench Press')).id)
      const unfinished = await repo.startSession(day.id)
      await repo.discardSession(unfinished.id)
      expect(await repo.getActiveSession()).toBeUndefined()
      expect(await repo.getSession(unfinished.id)).toBeUndefined()
      expect(await repo.listSessions()).toEqual([])
      const data = await repo.exportAll()
      expect(data.workout_sessions).toEqual([])
      expect(data.set_logs).toEqual([])

      const finished = await repo.startSession(day.id)
      await repo.finishSession(finished.id)
      await expect(repo.discardSession(finished.id)).rejects.toThrow()
      expect(await repo.getSession(finished.id)).toBeDefined()
      expect((await repo.listSessions()).map((s) => s.id)).toEqual([finished.id])
    })

    contract(
      'sessions',
      'listSessions is completed-only, newest first; getSession returns snapshots',
      async ({ repo }) => {
        const bench = await exercise(repo, 'Bench Press')
        const { plan, day } = await planWithDay(repo, 'Original plan', 'Original day')
        const item = await repo.addPlanItem(day.id, bench.id)
        await repo.updatePlanItem(item.id, { sets: 2, reps: 5, weight: 95 })

        const a = await repo.startSession(day.id)
        await markDone(repo, a, item.id)
        await repo.finishSession(a.id)
        const aDone = must((await repo.getSession(a.id))?.completed_at, 'completed_at')
        await pastInstant(aDone)
        const b = await repo.startSession(day.id)
        await repo.finishSession(b.id)
        const bDone = must((await repo.getSession(b.id))?.completed_at, 'completed_at')
        await pastInstant(bDone)
        const active = await repo.startSession(day.id)

        const listed = await repo.listSessions()
        expect(listed.map((s) => s.id)).toEqual([b.id, a.id])
        expect(listed.every((s) => s.completed_at !== null)).toBe(true)
        expect(listed.some((s) => s.id === active.id)).toBe(false)
        expect(Date.parse(must(listed[0]?.completed_at, 'completed_at'))).toBeGreaterThan(Date.parse(must(listed[1]?.completed_at, 'completed_at')))

        // the in-progress session is readable by id
        expect((await repo.getSession(active.id))?.completed_at).toBeNull()
        expect(await repo.getSession(newId())).toBeUndefined()

        // later edits never rewrite history
        await repo.savePlan({ id: plan.id, name: 'New plan name' })
        await repo.savePlanDay({ id: day.id, plan_id: plan.id, name: 'New day name' })
        await repo.saveExercise({ ...bench, name: 'Renamed lift', default_weight: 200 })
        await repo.updatePlanItem(item.id, { weight: 150 })
        const snap = must(await repo.getSession(a.id), 'session')
        expect(snap).toMatchObject({ plan_name: 'Original plan', day_name: 'Original day' })
        expect(snap.exercises).toHaveLength(1)
        expect(snap.exercises[0]).toMatchObject({ plan_item_id: item.id, exercise_name: 'Bench Press' })
        expect(snap.exercises[0]?.sets).toHaveLength(2)
        expect(snap.exercises[0]?.sets[0]).toMatchObject({
          exercise_name: 'Bench Press',
          target_reps: 5,
          target_weight: 95,
          weight: 95,
          done: true,
        })
        expect((await repo.listSessions())[0]).toMatchObject({ plan_name: 'Original plan', day_name: 'Original day' })
      },
    )

    // --------------------------------------------------------------- transfer
    contract(
      'transfer',
      'exportAll then importing into a fresh harness reproduces the data',
      async ({ repo, h, make: makeAnother, skip }) => {
        if (!h.importAll) return skip()
        const bench = await exercise(repo, 'Bench Press')
        const squat = await exercise(repo, 'Back Squat')
        await repo.updateProfile({ default_rule: rule({ success_amount: 10 }) })
        await repo.saveGear({ name: 'Sandbag', owned: false })
        const { plan, day } = await planWithDay(repo, 'Strength', 'Day 1')
        const day2 = await repo.savePlanDay({ plan_id: plan.id, name: 'Day 2' })
        const i1 = await repo.addPlanItem(day.id, bench.id)
        await repo.updatePlanItem(i1.id, { sets: 1 })
        const i2 = await repo.addPlanItem(day.id, squat.id)
        await repo.setRule(i2.id, null)
        await repo.addPlanItem(day2.id, squat.id)
        const dropped = await repo.savePlan({ name: 'Dropped' })
        await repo.deletePlan(dropped.id)
        const s1 = await repo.startSession(day.id)
        await markDone(repo, s1, i1.id)
        await repo.updateSessionNote(s1.id, 'felt good')
        await repo.finishSession(s1.id)
        await repo.startSession(day.id) // left in progress

        const data = await repo.exportAll()
        const other = await makeAnother({ empty: true })
        const importAll = must(other.importAll, 'importAll')
        await importAll(data)

        const copy = await other.repo.exportAll()
        expect(normalise(copy)).toEqual(normalise(data))
        expect(copy.profile.user_id).not.toBe(data.profile.user_id)
        expect(await other.repo.listExercises()).toHaveLength(16)
        expect((await other.repo.getActiveSession())?.id).toBe((await repo.getActiveSession())?.id)
        const withoutOwner = (value: unknown) =>
          JSON.parse(JSON.stringify(value, (k, v: unknown) => (k === 'user_id' ? undefined : v)))
        expect(withoutOwner(await other.repo.getPlan(plan.id))).toEqual(withoutOwner(await repo.getPlan(plan.id)))
      },
    )
  })
}
