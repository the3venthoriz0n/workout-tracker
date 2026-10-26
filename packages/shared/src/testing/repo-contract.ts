/**
 * Behavioral contract for every `Repo` implementation (LocalRepo, the server service layer, ApiRepo).
 * Expectations come from docs/spec.md §5 and §6 and go through the `Repo` interface only.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { defaultRule } from '../progression.js'
import { LIMITS } from '../schemas.js'
import { ImportInvalidError, SessionInProgressError } from '../repo.js'
import type { ExportData, PlanTree, Repo, SessionDetail } from '../repo.js'
import type { Exercise, PlanItem, RuleInput } from '../schemas.js'
import { newId } from '../id.js'
import { snapshotFromPlanTree } from '../community.js'

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
  | 'community'

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

/** The typed validation error every implementation throws (ApiRepo maps the API's 400 to it). */
async function expectInvalid(p: Promise<unknown>): Promise<void> {
  await expect(p).rejects.toMatchObject({ name: 'ValidationError' })
}
async function expectNotFound(p: Promise<unknown>): Promise<void> {
  await expect(p).rejects.toMatchObject({ name: 'NotFoundError' })
}
/** Every set of a session in display order (seq, the snapshot written at start). */
function displayOrder(session: SessionDetail) {
  return session.exercises.flatMap((e) => e.sets).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
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
    opts?.groups ?? ['profile', 'gear', 'exercises', 'plans', 'progression', 'sessions', 'transfer', 'community'],
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
      // Items without an override inherit at read time, so existing items follow the new default
      // (owner decision: layered rules replace copy-on-add).
      expect(await planItem(repo, plan.id, first.id)).toMatchObject({ rule: custom, ruleSource: 'profile' })
      expect((await repo.exportAll()).progression_rules).toEqual([])

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

    // ------------------------------------------- day colours, angle, AMRAP, supersets
    contract('plans', 'plan days take an optional palette colour; an update without one keeps it', async ({ repo }) => {
      const plan = await repo.savePlan({ name: 'P' })
      const plain = await repo.savePlanDay({ plan_id: plan.id, name: 'A' })
      expect(plain.color).toBeNull()
      const coloured = await repo.savePlanDay({ plan_id: plan.id, name: 'B', color: 'teal' })
      expect(coloured.color).toBe('teal')
      await repo.savePlanDay({ id: coloured.id, plan_id: plan.id, name: 'B2' })
      expect((await tree(repo, plan.id)).days.map((d) => [d.name, d.color])).toEqual([
        ['A', null],
        ['B2', 'teal'],
      ])
      await repo.savePlanDay({ id: coloured.id, plan_id: plan.id, name: 'B2', color: 'red' })
      expect((await tree(repo, plan.id)).days[1]?.color).toBe('red')
      await repo.savePlanDay({ id: coloured.id, plan_id: plan.id, name: 'B2', color: null })
      expect((await tree(repo, plan.id)).days[1]?.color).toBeNull()
      await expect(repo.savePlanDay({ plan_id: plan.id, name: 'X', color: 'mauve' as never })).rejects.toThrow()
      expect((await tree(repo, plan.id)).days).toHaveLength(2)
    })

    contract(
      'plans',
      'angle is set per plan item, only on exercises that support it; turning support off clears it',
      async ({ repo }) => {
        const bench = await exercise(repo, 'Bench Press')
        expect(bench.supports_angle).toBe(false)
        expect(bench.default_rule).toBeNull()
        const { plan, day } = await planWithDay(repo)
        const a = await repo.addPlanItem(day.id, bench.id)
        expect(a).toMatchObject({ angle: null, amrap_last: false, superset_group: null })
        await expectInvalid(repo.updatePlanItem(a.id, { angle: 'incline' }))
        expect((await planItem(repo, plan.id, a.id)).angle).toBeNull()

        const saved = await repo.saveExercise({ ...bench, supports_angle: true })
        expect(saved.supports_angle).toBe(true)
        // a save that does not mention the flag keeps it
        const { supports_angle: _flag, ...withoutFlag } = saved
        expect((await repo.saveExercise({ ...withoutFlag, notes: 'tempo' })).supports_angle).toBe(true)

        // the same exercise as incline in one item and flat in another, each with its own targets
        expect(await repo.updatePlanItem(a.id, { angle: 'incline', weight: 80 })).toMatchObject({ angle: 'incline', weight: 80 })
        const b = await repo.addPlanItem(day.id, bench.id)
        await repo.updatePlanItem(b.id, { angle: 'flat', weight: 100 })
        const items = (await tree(repo, plan.id)).days[0]?.items ?? []
        expect(items.map((i) => [i.angle, i.effective.targetWeight])).toEqual([
          ['incline', 80],
          ['flat', 100],
        ])
        // an angle edit is not a reps/weight edit: targets stay
        expect(await repo.updatePlanItem(b.id, { amrap_last: true })).toMatchObject({ amrap_last: true, angle: 'flat' })
        await expect(repo.updatePlanItem(a.id, { angle: 'sideways' as never })).rejects.toThrow()
        expect(await repo.updatePlanItem(a.id, { angle: null })).toMatchObject({ angle: null })
        await repo.updatePlanItem(a.id, { angle: 'decline' })

        await repo.saveExercise({ ...withoutFlag, supports_angle: false })
        const after = (await tree(repo, plan.id)).days[0]?.items ?? []
        expect(after.map((i) => i.angle)).toEqual([null, null])
        expect(after.map((i) => i.amrap_last)).toEqual([false, true])
      },
    )

    contract(
      'sessions',
      'startSession snapshots angle and AMRAP (last set only); extra AMRAP reps progress like any success',
      async ({ repo }) => {
        const bench = await repo.saveExercise({ ...(await exercise(repo, 'Bench Press')), supports_angle: true })
        const squat = await exercise(repo, 'Back Squat')
        const { day } = await planWithDay(repo)
        const a = await repo.addPlanItem(day.id, bench.id)
        await repo.updatePlanItem(a.id, { sets: 3, reps: 5, weight: 100, angle: 'decline', amrap_last: true })
        const b = await repo.addPlanItem(day.id, squat.id)
        await repo.updatePlanItem(b.id, { sets: 2 })

        const session = await repo.startSession(day.id)
        expect(setsOf(session, a.id).map((s) => [s.set_no, s.angle, s.amrap])).toEqual([
          [1, 'decline', false],
          [2, 'decline', false],
          [3, 'decline', true],
        ])
        expect(setsOf(session, b.id).map((s) => [s.angle, s.amrap, s.superset_group, s.superset_label])).toEqual([
          [null, false, null, null],
          [null, false, null, null],
        ])
        const [s1, s2, s3] = setsOf(session, a.id)
        await repo.updateSet(must(s1, 'set').id, { done: true })
        await repo.updateSet(must(s2, 'set').id, { done: true })
        await repo.updateSet(must(s3, 'set').id, { done: true, actual_reps: 11 })
        const summary = await repo.finishSession(session.id)
        expect(summary.find((r) => r.exercise_name === 'Bench Press')).toMatchObject({
          outcome: 'success',
          before: { reps: 5, weight: 100 },
          after: { reps: 5, weight: 105 },
        })

        // history keeps the snapshot after the plan changes
        await repo.updatePlanItem(a.id, { angle: 'flat', amrap_last: false })
        const history = must(await repo.getSession(session.id), 'session')
        expect(setsOf(history, a.id).map((s) => [s.angle, s.amrap, s.actual_reps])).toEqual([
          ['decline', false, 5],
          ['decline', false, 5],
          ['decline', true, 11],
        ])
        const next = await repo.startSession(day.id)
        expect(setsOf(next, a.id).map((s) => [s.angle, s.amrap])).toEqual([
          ['flat', false],
          ['flat', false],
          ['flat', false],
        ])
      },
    )

    contract(
      'sessions',
      'setSuperset groups 2-3 items of one day; sessions interleave members and label them',
      async ({ repo }) => {
        const names = ['Bench Press', 'Barbell Row', 'Overhead Press', 'Pull-up', 'Back Squat', 'Deadlift']
        const ex = await Promise.all(names.map((n) => exercise(repo, n)))
        const { plan, day } = await planWithDay(repo)
        const other = await repo.savePlanDay({ plan_id: plan.id, name: 'Other' })
        const add = async (d: string, e: Exercise, sets: number) => {
          const i = await repo.addPlanItem(d, e.id)
          await repo.updatePlanItem(i.id, { sets })
          return i
        }
        const x = await add(day.id, must(ex[0], 'ex'), 1)
        const a = await add(day.id, must(ex[1], 'ex'), 3)
        const b = await add(day.id, must(ex[2], 'ex'), 2)
        const c = await add(day.id, must(ex[3], 'ex'), 1)
        const o1 = await add(other.id, must(ex[4], 'ex'), 1)
        const o2 = await add(other.id, must(ex[5], 'ex'), 1)
        const g = newId()
        await repo.setSuperset(day.id, g, [a.id, b.id])
        const groups = async () => (await tree(repo, plan.id)).days.flatMap((d) => d.items.map((i) => i.superset_group))
        expect(await groups()).toEqual([null, g, g, null, null, null])

        await expectInvalid(repo.setSuperset(day.id, newId(), [x.id])) // too small
        await expectInvalid(repo.setSuperset(day.id, newId(), [x.id, a.id, b.id, c.id])) // too big
        await expectInvalid(repo.setSuperset(day.id, newId(), [x.id, x.id])) // duplicate
        await expectInvalid(repo.setSuperset(day.id, newId(), [x.id, o1.id])) // another day
        await expectNotFound(repo.setSuperset(day.id, newId(), [x.id, newId()]))
        await expectNotFound(repo.setSuperset(newId(), newId(), [x.id, c.id]))
        // a group id belongs to one day
        await expect(repo.setSuperset(other.id, g, [o1.id, o2.id])).rejects.toMatchObject({ name: 'ConflictError' })
        expect(await groups()).toEqual([null, g, g, null, null, null])

        const session = await repo.startSession(day.id)
        expect(session.exercises.map((e) => e.plan_item_id)).toEqual([x.id, a.id, b.id, c.id])
        const order = displayOrder(session)
        expect(order.map((s) => [s.plan_item_id, s.set_no])).toEqual([
          [x.id, 1],
          [a.id, 1],
          [b.id, 1],
          [a.id, 2],
          [b.id, 2],
          [a.id, 3],
          [c.id, 1],
        ])
        expect(order.map((s) => s.seq)).toEqual([0, 1, 2, 3, 4, 5, 6])
        expect(order.map((s) => s.superset_label)).toEqual([null, 'A1', 'A2', 'A1', 'A2', 'A1', null])
        expect(order.map((s) => s.superset_group)).toEqual([null, g, g, g, g, g, null])
        await repo.finishSession(session.id)

        // ungrouping changes the plan, never the history
        await repo.setSuperset(day.id, g, null)
        expect(await groups()).toEqual([null, null, null, null, null, null])
        const history = displayOrder(must(await repo.getSession(session.id), 'session'))
        expect(history.map((s) => s.superset_label)).toEqual([null, 'A1', 'A2', 'A1', 'A2', 'A1', null])
        // three members are allowed
        await repo.setSuperset(day.id, g, [c.id, x.id, a.id])
        expect(await groups()).toEqual([g, g, null, g, null, null])
      },
    )

    contract(
      'plans',
      'a superset shrinks when a member leaves and dissolves at one member',
      async ({ repo }) => {
        const names = ['Bench Press', 'Barbell Row', 'Overhead Press', 'Pull-up']
        const ex = await Promise.all(names.map((n) => exercise(repo, n)))
        const { plan, day } = await planWithDay(repo)
        const added: PlanItem[] = []
        for (const e of ex) added.push(await repo.addPlanItem(day.id, e.id))
        const [a, b, c, d] = added.map((i) => i.id)
        const ids = { a: must(a, 'a'), b: must(b, 'b'), c: must(c, 'c'), d: must(d, 'd') }
        const groupOf = async () =>
          Object.fromEntries(((await tree(repo, plan.id)).days[0]?.items ?? []).map((i) => [i.id, i.superset_group]))
        const g1 = newId()
        const g2 = newId()
        await repo.setSuperset(day.id, g1, [ids.a, ids.b, ids.c])
        await repo.deletePlanItem(ids.c)
        expect(await groupOf()).toEqual({ [ids.a]: g1, [ids.b]: g1, [ids.d]: null })
        // regrouping moves b out of g1, which is left with one member and dissolves
        await repo.setSuperset(day.id, g2, [ids.b, ids.d])
        expect(await groupOf()).toEqual({ [ids.a]: null, [ids.b]: g2, [ids.d]: g2 })
        // re-setting a group replaces its member list
        await repo.setSuperset(day.id, g2, [ids.b, ids.d, ids.a])
        expect(await groupOf()).toEqual({ [ids.a]: g2, [ids.b]: g2, [ids.d]: g2 })
        await repo.setSuperset(day.id, g2, [ids.b, ids.d])
        expect(await groupOf()).toEqual({ [ids.a]: null, [ids.b]: g2, [ids.d]: g2 })
        // deleting an exercise removes its items from groups too
        await repo.deleteExercise(must(ex[3], 'ex').id)
        expect(await groupOf()).toEqual({ [ids.a]: null, [ids.b]: null })
        // deleted items never keep a group
        const data = await repo.exportAll()
        expect(data.plan_items.filter((i) => i.deleted_at !== null).map((i) => i.superset_group)).toEqual([null, null])
      },
    )

    contract(
      'progression',
      'rules layer item ?? exercise ?? profile ?? built-in; new items inherit until overridden',
      async ({ repo }) => {
        const bench = await exercise(repo, 'Bench Press')
        const squat = await exercise(repo, 'Back Squat')
        const { plan, day } = await planWithDay(repo)
        const a = await repo.addPlanItem(day.id, bench.id)
        const b = await repo.addPlanItem(day.id, squat.id)
        const view = async (id: string) => {
          const i = await planItem(repo, plan.id, id)
          return { rule: i.rule, source: i.ruleSource }
        }
        expect((await repo.exportAll()).progression_rules).toEqual([])
        expect(await view(a.id)).toEqual({ rule: defaultRule(5), source: 'builtin' })

        const P = rule({ success_amount: 20 })
        const E = rule({ success_action: 'add_reps', success_amount: 1, rep_ceiling: 10 })
        const I = rule({ success_amount: 15, fail_streak_limit: 2 })
        await repo.updateProfile({ default_rule: P })
        expect(await view(a.id)).toEqual({ rule: P, source: 'profile' })
        await repo.setExerciseRule(bench.id, E)
        expect((await exercise(repo, 'Bench Press')).default_rule).toEqual(E)
        expect(await view(a.id)).toEqual({ rule: E, source: 'exercise' })
        expect(await view(b.id)).toEqual({ rule: P, source: 'profile' })
        await repo.setRule(a.id, I)
        expect(await view(a.id)).toEqual({ rule: I, source: 'item' })
        await repo.setRule(b.id, null) // explicit "no progression" override
        expect(await view(b.id)).toEqual({ rule: null, source: 'item' })
        const rows = await repo.listProgression()
        expect(rows.map((r) => [r.item_id, r.exercise_id, r.ruleSource])).toEqual([
          [a.id, bench.id, 'item'],
          [b.id, squat.id, 'item'],
        ])

        await repo.clearRule(a.id)
        await repo.clearRule(b.id)
        expect(await view(a.id)).toEqual({ rule: E, source: 'exercise' })
        expect(await view(b.id)).toEqual({ rule: P, source: 'profile' })
        await repo.clearRule(a.id) // clearing twice is fine
        await repo.setExerciseRule(bench.id, null)
        expect((await exercise(repo, 'Bench Press')).default_rule).toBeNull()
        expect(await view(a.id)).toEqual({ rule: P, source: 'profile' })
        expect((await repo.listProgression()).map((r) => [r.ruleSource, r.rule])).toEqual([
          ['profile', P],
          ['profile', P],
        ])

        await expect(repo.setExerciseRule(bench.id, rule({ success_amount: 0 }))).rejects.toThrow()
        await expectNotFound(repo.setExerciseRule(newId(), E))
        await expectNotFound(repo.clearRule(newId()))
        expect((await repo.exportAll()).progression_rules).toEqual([])
      },
    )

    contract('progression', 'finishSession progresses with the resolved rule', async ({ repo }) => {
      const bench = await exercise(repo, 'Bench Press')
      const { plan, day } = await planWithDay(repo)
      const item = await repo.addPlanItem(day.id, bench.id)
      await repo.updatePlanItem(item.id, { sets: 1, reps: 5, weight: 100 })
      const finish = async () => {
        const s = await repo.startSession(day.id)
        await markDone(repo, s, item.id)
        return must((await repo.finishSession(s.id))[0], 'summary row')
      }
      await repo.setExerciseRule(bench.id, rule({ success_amount: 10 }))
      expect(await finish()).toMatchObject({ outcome: 'success', after: { weight: 110 } })
      await repo.updateProfile({ default_rule: rule({ success_amount: 20 }) })
      expect(await finish()).toMatchObject({ outcome: 'success', after: { weight: 120 } }) // exercise still wins
      await repo.setExerciseRule(bench.id, null)
      expect(await finish()).toMatchObject({ outcome: 'success', after: { weight: 140 } }) // profile
      await repo.setRule(item.id, null)
      expect(await finish()).toMatchObject({ outcome: 'skipped', after: { weight: 140 } })
      expect((await planItem(repo, plan.id, item.id)).target_weight).toBe(140)
    })

    contract(
      'progression',
      'listProgressionByExercise lists every live exercise once with its default, overrides and inheriting items',
      async ({ repo }) => {
        const bench = await exercise(repo, 'Bench Press')
        const squat = await exercise(repo, 'Back Squat')
        const p = await repo.savePlan({ name: 'One' })
        const d = await repo.savePlanDay({ plan_id: p.id, name: 'A' })
        const i1 = await repo.addPlanItem(d.id, bench.id)
        const i2 = await repo.addPlanItem(d.id, bench.id)
        const i3 = await repo.addPlanItem(d.id, squat.id)
        const gone = await repo.addPlanItem(d.id, squat.id)
        await repo.deletePlanItem(gone.id)
        const I = rule({ success_amount: 15 })
        const E = rule({ success_amount: 25 })
        await repo.setRule(i2.id, I)
        await repo.setExerciseRule(squat.id, E)

        const rows = await repo.listProgressionByExercise()
        const live = await repo.listExercises()
        expect(rows.map((r) => r.exercise_id)).toEqual(live.map((e) => e.id))
        const at = { plan_id: p.id, plan_name: 'One', day_id: d.id, day_name: 'A' }
        expect(rows.find((r) => r.exercise_id === bench.id)).toEqual({
          exercise_id: bench.id,
          exercise_name: 'Bench Press',
          rule: defaultRule(5),
          source: 'builtin',
          overrides: [{ ...at, item_id: i2.id, rule: I }],
          inheriting: [{ ...at, item_id: i1.id }],
        })
        expect(rows.find((r) => r.exercise_id === squat.id)).toMatchObject({
          rule: E,
          source: 'exercise',
          overrides: [],
          inheriting: [{ ...at, item_id: i3.id }],
        })
        expect(rows.find((r) => r.exercise_name === 'Deadlift')).toMatchObject({ overrides: [], inheriting: [] })
        await repo.deleteExercise(bench.id)
        expect((await repo.listProgressionByExercise()).some((r) => r.exercise_id === bench.id)).toBe(false)
      },
    )

    contract('profile', 'a unit switch converts add_weight exercise default rules too', async ({ repo }) => {
      const bench = await exercise(repo, 'Bench Press')
      const squat = await exercise(repo, 'Back Squat')
      const row = await exercise(repo, 'Barbell Row')
      await repo.setExerciseRule(bench.id, rule({ success_amount: 10 }))
      await repo.setExerciseRule(squat.id, rule({ success_action: 'add_reps', success_amount: 2 }))
      await repo.setExerciseRule(row.id, rule({ success_amount: 5 }))
      await repo.updateProfile({ units: 'kg' })
      expect((await exercise(repo, 'Bench Press')).default_rule?.success_amount).toBe(5) // 4.5 kg -> nearest 2.5
      expect((await exercise(repo, 'Back Squat')).default_rule?.success_amount).toBe(2)
      expect((await exercise(repo, 'Barbell Row')).default_rule?.success_amount).toBe(2.5) // the old step
    })

    contract('profile', 'a unit switch clamps converted rule amounts to the weight limit', async ({ repo }) => {
      const bench = await exercise(repo, 'Bench Press')
      await repo.updateProfile({ units: 'kg' })
      await repo.setExerciseRule(bench.id, rule({ success_amount: 90_000 }))
      await repo.updateProfile({ units: 'lb' }) // 90000 kg -> ~198000 lb
expect((await exercise(repo, 'Bench Press')).default_rule?.success_amount).toBe(LIMITS.weight)
      expect((await repo.listExercises()).length).toBeGreaterThan(0) // still parses
    })

    // -------------------------------------------------------------- community
    contract('community', 'display_name is validated and trimmed, and can be changed', async ({ repo }) => {
      expect((await repo.getProfile()).display_name).toBeNull()
      await expectInvalid(repo.updateProfile({ display_name: 'x' }))
      await expectInvalid(repo.updateProfile({ display_name: 'no@links' }))
      expect((await repo.getProfile()).display_name).toBeNull()
      expect((await repo.updateProfile({ display_name: '  Jo Lifts ' })).display_name).toBe('Jo Lifts')
      expect((await repo.updateProfile({ display_name: 'Jo_2' })).display_name).toBe('Jo_2')
      expect((await repo.updateProfile({ units: 'kg' })).display_name).toBe('Jo_2')
    })

    contract(
      'community',
      'adoptSharedPlan makes an independent copy: names matched, missing ones recreated, units converted, source kept',
      async ({ repo }) => {
        await repo.updateProfile({ display_name: 'Jo Lifts' })
        const bench = await exercise(repo, 'Bench Press')
        await repo.saveExercise({ ...bench, supports_angle: true })
        const deadlift = await exercise(repo, 'Deadlift')
        const sledGear = await repo.saveGear({ name: 'Sled', owned: true })
        const sled = await repo.saveExercise({
          name: 'Sled Push', notes: 'private note', video_url: 'https://video.example.invalid/x', required_gear_ids: [sledGear.id],
          active: true, default_sets: 4, default_reps: 20, default_weight: 90,
        })
        const { plan, day } = await planWithDay(repo, 'Strength', 'Push')
        await repo.savePlanDay({ id: day.id, plan_id: plan.id, name: 'Push', color: 'red' })
        const a = await repo.addPlanItem(day.id, bench.id)
        await repo.updatePlanItem(a.id, { sets: 3, reps: 5, weight: 135, angle: 'incline', amrap_last: true })
        await repo.setRule(a.id, rule({ success_amount: 10 }))
        const b = await repo.addPlanItem(day.id, sled.id)
        await repo.setRule(b.id, null)
        await repo.setSuperset(day.id, newId(), [a.id, b.id])
        await repo.addPlanItem(day.id, deadlift.id) // inherits the built-in rule (5 lb)
        await repo.savePlanDay({ plan_id: plan.id, name: 'Empty day' }) // normalized away

        const meta = { title: 'Strong 5x5', description: '', level: 'beginner' as const }
        const snapshot = snapshotFromPlanTree(await tree(repo, plan.id), 'lb', await repo.listGear())
        let listing: { shared_plan_id: string; version: number }
        try {
          listing = await repo.publishPlan(plan.id, meta)
        } catch (e) {
          // Guests cannot publish; they adopt from a snapshot fetched from the public API.
          if ((e as Error).name !== 'UnauthenticatedError') throw e
          listing = { shared_plan_id: newId(), version: 1 }
        }
        expect(listing.version).toBe(1)
        const input = { ...listing, snapshot, title: meta.title, author: 'Jo Lifts' }

        // The original changes after sharing; the shared version does not.
        await repo.savePlan({ id: plan.id, name: 'Renamed' })
        await repo.updatePlanItem(a.id, { weight: 200 })
        await repo.deleteExercise(sled.id)
        await repo.deleteGear(sledGear.id)
        await repo.updateProfile({ units: 'kg' })

        const { plan_id } = await repo.adoptSharedPlan(input)
        const copy = await tree(repo, plan_id)
        expect(copy.name).toBe('Strength')
        expect(copy.source).toEqual({ shared_plan_id: listing.shared_plan_id, version: 1, title: 'Strong 5x5', author: 'Jo Lifts' })
        expect(copy.published).toBeNull()
        expect(copy.days.map((d) => [d.name, d.color])).toEqual([['Push', 'red']])
        const [ca, cb, cc] = must(copy.days[0], 'day').items
        // 135 lb = 61.2 kg -> 60 on the 2.5 kg step; 10 lb = 4.5 kg -> 5; 5 lb = 2.3 kg -> 2.5
        expect(ca).toMatchObject({ exercise_id: bench.id, sets: 3, reps: 5, weight: 60, angle: 'incline', amrap_last: true })
        expect(ca).toMatchObject({ target_reps: null, target_weight: null, ruleSource: 'item', rule: rule({ success_amount: 5 }) })
        expect(cb!.exercise).toMatchObject({ name: 'Sled Push', notes: '', video_url: null, default_sets: 4 })
        expect(cb!.exercise_id).not.toBe(sled.id)
        expect(cb).toMatchObject({ sets: 4, reps: 20, weight: 40, rule: null, ruleSource: 'item' })
        expect(cc).toMatchObject({ exercise_id: deadlift.id, rule: rule({ success_amount: 2.5 }), ruleSource: 'item' })
        expect(ca!.superset_group).not.toBeNull()
        expect(cb!.superset_group).toBe(ca!.superset_group)
        expect(cc!.superset_group).toBeNull()
        const newSled = must((await repo.listGear()).find((g) => g.name === 'Sled'), 'Sled gear')
        expect(newSled).toMatchObject({ owned: false })
        expect(newSled.id).not.toBe(sledGear.id)
        expect(cb!.exercise.required_gear_ids).toEqual([newSled.id])

        // Copy and original are independent.
        await repo.updatePlanItem(ca!.id, { sets: 9 })
        expect((await planItem(repo, plan.id, a.id)).sets).toBe(3)
        expect((await tree(repo, plan.id)).name).toBe('Renamed')

        // A second adopt is a second, independent copy that reuses what the first one created.
        const again = await repo.adoptSharedPlan(input)
        expect(again.plan_id).not.toBe(plan_id)
        const copy2 = must((await tree(repo, again.plan_id)).days[0], 'day').items
        expect(copy2[0]!.sets).toBe(3)
        expect(copy2[1]!.exercise_id).toBe(cb!.exercise_id)
        expect(copy2[0]!.superset_group).not.toBe(ca!.superset_group)
        expect((await repo.listExercises()).filter((e) => e.name === 'Sled Push')).toHaveLength(1)
        expect((await repo.listGear()).filter((g) => g.name === 'Sled')).toHaveLength(1)

        const exported = await repo.exportAll()
        expect(exported.profile.display_name).toBe('Jo Lifts')
        expect(exported.plans.find((p) => p.id === plan_id)?.source).toEqual(copy.source)
      },
    )

    // --------------------------------------------------------------- transfer
    contract('transfer', 'import rejects an angle on an exercise that does not support one', async ({ repo, make: makeAnother, skip }) => {
      if (!(await makeAnother({ empty: true })).importAll) return skip()
      const bench = await exercise(repo, 'Bench Press')
      expect(bench.supports_angle).toBe(false)
      const { day } = await planWithDay(repo)
      await repo.addPlanItem(day.id, bench.id)
      const data = await repo.exportAll()
      const bad = structuredClone(data)
      bad.plan_items[0]!.angle = 'incline'
      const target = await makeAnother({ empty: true })
      await expect(must(target.importAll, 'importAll')(bad)).rejects.toBeInstanceOf(ImportInvalidError)
      const ok = structuredClone(data)
      ok.exercises.find((e) => e.id === bench.id)!.supports_angle = true
      ok.plan_items[0]!.angle = 'incline'
      await must((await makeAnother({ empty: true })).importAll, 'importAll')(ok)
    })

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
        // the new fields round-trip too
        await repo.savePlanDay({ id: day2.id, plan_id: plan.id, name: 'Day 2', color: 'violet' })
        await repo.saveExercise({ ...bench, supports_angle: true })
        await repo.setExerciseRule(squat.id, rule({ success_amount: 15 }))
        await repo.updatePlanItem(i1.id, { angle: 'incline', amrap_last: true })
        const i3 = await repo.addPlanItem(day.id, (await exercise(repo, 'Deadlift')).id)
        await repo.setSuperset(day.id, newId(), [i2.id, i3.id])
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
