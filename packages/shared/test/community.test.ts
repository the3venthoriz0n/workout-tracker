import { describe, expect, it } from 'vitest'
import {
  COMMUNITY,
  ValidationError,
  displayNameSchema,
  exportDataSchema,
  fetchCommunityList,
  fetchCommunityPlan,
  listingMetaSchema,
  planFromSnapshot,
  planSchema,
  profileSchema,
  publicListQuerySchema,
  sharedSnapshotSchema,
  snapshotFromPlanTree,
  NotFoundError,
  OfflineError,
  ApiError,
  nameKey,
} from '../src/index.js'
import type { AdoptContext, Exercise, Gear, PlanItemView, PlanSource, PlanTree, SharedSnapshot } from '../src/index.js'
import { defaultRule } from '../src/progression.js'

const ts = '2026-01-01T00:00:00.000Z'
const sync = { created_at: ts, updated_at: ts, deleted_at: null }
const U = 'user-1'
let n = 0
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`

function gear(name: string): Gear {
  return { id: id(), name, owned: true, user_id: U, ...sync }
}
function exercise(name: string, over: Partial<Exercise> = {}): Exercise {
  return {
    id: id(), name, notes: 'SECRET NOTE', video_url: 'https://video.example/secret', required_gear_ids: [], active: true,
    default_sets: 3, default_reps: 5, default_weight: 100, supports_angle: false, default_rule: null, user_id: U, ...sync, ...over,
  }
}
function item(ex: Exercise, over: Partial<PlanItemView> = {}): PlanItemView {
  const base = {
    id: id(), plan_day_id: id(), exercise_id: ex.id, position: 0, sets: null, reps: null, weight: null,
    target_reps: 120, target_weight: 999, angle: null, amrap_last: false, superset_group: null, inherit_rule: true, ...sync,
  }
  return {
    ...base,
    exercise: ex,
    rule: defaultRule(5),
    ruleSource: 'builtin',
    effective: { sets: ex.default_sets, baseReps: ex.default_reps, baseWeight: ex.default_weight, targetReps: 120, targetWeight: 999 },
    ...over,
  }
}
function tree(days: { name: string; items: PlanItemView[]; color?: PlanTree['days'][number]['color'] }[]): PlanTree {
  const planId = id()
  return {
    id: planId, name: 'My Plan', archived: false, source: null, published: null, user_id: U, ...sync,
    days: days.map((d, i) => ({ id: id(), plan_id: planId, name: d.name, position: i, color: d.color ?? null, ...sync, items: d.items })),
  }
}

describe('schemas', () => {
  it('display_name: 2-30 letters, digits, spaces, _ - .', () => {
    for (const ok of ['Al', 'Jo Lifts', 'iron_maiden-2', 'Zoë Ström', 'Zoe\u0308', 'x'.repeat(30)]) {
      expect(displayNameSchema.safeParse(ok).success, ok).toBe(true)
    }
    for (const bad of ['A', 'x'.repeat(31), 'bob@mail', 'a/b', '<script>', '', '   ', 'Jo.Lifts', 'spam.com', 'Zx\u0301\u0302\u0303\u0304']) {
      expect(displayNameSchema.safeParse(bad).success, bad).toBe(false)
    }
    // Stored cleaned: control and format characters stripped, NFKC applied.
    expect(displayNameSchema.parse('Tab\there')).toBe('Tabhere')
    expect(displayNameSchema.parse('Ｊｏ\u200b Lifts')).toBe('Jo Lifts')
  })

  it('listing meta: title 3-60, description 0-500, level enum, no links, control characters stripped', () => {
    expect(listingMetaSchema.parse({ title: '  5x5 Basics  ' })).toEqual({ title: '5x5 Basics', description: '', level: null })
    expect(listingMetaSchema.parse({ title: 'A\u0000B‮C', description: 'line 1\nline 2\u0007', level: 'advanced' })).toEqual({
      title: 'ABC',
      description: 'line 1\nline 2',
      level: 'advanced',
    })
    const bad = [
      { title: 'ab' },
      { title: 'x'.repeat(61) },
      { title: 'Good title', description: 'x'.repeat(501) },
      { title: 'Good title', level: 'expert' },
      { title: 'See http://evil.example' },
      { title: 'See HTTPS://evil.example' },
      { title: 'Visit www.evil.example' },
      { title: 'Good title', description: 'more at https://x.example' },
    ]
    for (const b of bad) expect(listingMetaSchema.safeParse(b).success, JSON.stringify(b)).toBe(false)
  })

  it('old profiles and plans load with display_name, source and published null', () => {
    const profile = profileSchema.parse({ user_id: U, plan: 'free', units: 'lb', weight_increment: 5, ...sync })
    expect(profile.display_name).toBeNull()
    const plan = planSchema.parse({ id: id(), name: 'P', archived: false, user_id: U, ...sync })
    expect(plan.source).toBeNull()
    expect(plan.published).toBeNull()
  })

  it('an export written before community plans still parses; source and display_name round-trip', () => {
    const old = {
      version: 1, exported_at: ts,
      profile: { user_id: U, plan: 'free', units: 'lb', weight_increment: 5, ...sync },
      gear: [], exercises: [], plans: [{ id: id(), name: 'P', archived: false, user_id: U, ...sync }],
      plan_days: [], plan_items: [], progression_rules: [], item_states: [], workout_sessions: [], set_logs: [],
    }
    const parsed = exportDataSchema.parse(old)
    expect(parsed.profile.display_name).toBeNull()
    expect(parsed.plans[0]!.source).toBeNull()
    const source: PlanSource = { shared_plan_id: id(), version: 2, title: 'Strong 5x5', author: 'Jo Lifts' }
    const next = exportDataSchema.parse({
      ...old,
      profile: { ...old.profile, display_name: 'Jo Lifts' },
      plans: [{ ...old.plans[0], source }],
    })
    expect(next.profile.display_name).toBe('Jo Lifts')
    expect(next.plans[0]!.source).toEqual(source)
  })

  it('public list query: defaults, bounds and coercion', () => {
    expect(publicListQuerySchema.parse({})).toEqual({ sort: 'top', limit: COMMUNITY.pageSize })
    expect(publicListQuerySchema.parse({ days: '3', limit: '5', gear: 'none', level: 'beginner', q: '%_' })).toMatchObject({
      days: 3, limit: 5, gear: 'none', level: 'beginner', q: '%_',
    })
    for (const bad of [{ limit: '21' }, { limit: '0' }, { days: 'x' }, { sort: 'hot' }, { gear: 'some' }, { q: 'x'.repeat(101) }]) {
      expect(publicListQuerySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false)
    }
  })
})

describe('public text: one link check for every public string', () => {
  const BYPASSES = ['www\u200b.spam.com', 'ｗｗｗ．x．com', 'hxxp://x', 'HXXPS://x', 'http://x', 'spam.com', 'see Spam.Com now', 'shop.example.co.uk', 'w\u00adww.spam.com', 'line\u2028www.spam.com']
  const item = (exercise: string, gear: string[] = []) => ({
    exercise, gear, supports_angle: false, sets: 3, reps: 5, weight: 100, angle: null, amrap_last: false, superset: null, rule: null,
  })
  const snap = (over: { name?: string; day?: string; exercise?: string; gear?: string[] }) => ({
    name: over.name ?? 'Plan', units: 'lb',
    days: [{ name: over.day ?? 'Day', color: null, items: [item(over.exercise ?? 'Squat', over.gear ?? [])] }],
  })

  it('rejects links and their bypasses in titles, descriptions, names and every snapshot string', () => {
    for (const b of BYPASSES) {
      expect(listingMetaSchema.safeParse({ title: `Plan ${b}` }).success, `title ${b}`).toBe(false)
      expect(listingMetaSchema.safeParse({ title: 'Good title', description: `x ${b}` }).success, `description ${b}`).toBe(false)
      expect(displayNameSchema.safeParse(b).success, `name ${b}`).toBe(false)
      for (const over of [{ name: b }, { day: b }, { exercise: b }, { gear: [b] }]) {
        expect(sharedSnapshotSchema.safeParse(snap(over)).success, `snapshot ${JSON.stringify(over)}`).toBe(false)
      }
    }
    // Ordinary text with dots or abbreviations still passes.
    for (const ok of ['5x5 v2. Heavy', 'Mon. and Thu.', 'D.B. Press', '3.5 kg plates', 'e.g. squats']) {
      expect(listingMetaSchema.safeParse({ title: 'Good title', description: ok }).success, ok).toBe(true)
    }
  })

  it('stores the cleaned, NFKC-normalized form', () => {
    expect(listingMetaSchema.parse({ title: 'Ｓｔｒｏｎｇ\u200b 5x5\u00ad' }).title).toBe('Strong 5x5')
    expect(sharedSnapshotSchema.parse(snap({ exercise: 'Ｂｅｎｃｈ\u200d Press' })).days[0]!.items[0]!.exercise).toBe('Bench Press')
  })

  it('caps gear at 5 names per exercise and the whole snapshot at 200 KB', () => {
    expect(sharedSnapshotSchema.safeParse(snap({ gear: ['a', 'b', 'c', 'd', 'e'] })).success).toBe(true)
    expect(sharedSnapshotSchema.safeParse(snap({ gear: ['a', 'b', 'c', 'd', 'e', 'f'] })).success).toBe(false)
    const long = (i: number) => `${'x'.repeat(190)}${i}`
    const huge = {
      name: 'Huge', units: 'lb',
      days: Array.from({ length: COMMUNITY.maxDays }, (_, d) => ({
        name: `D${d}`, color: null,
        items: Array.from({ length: COMMUNITY.maxItemsPerDay }, (_, i) => item(long(d * 100 + i), [long(1), long(2), long(3), long(4), long(5)])),
      })),
    }
    expect(JSON.stringify(huge).length).toBeGreaterThan(COMMUNITY.maxSnapshotBytes)
    expect(sharedSnapshotSchema.safeParse(huge).success).toBe(false)
    expect(() => planFromSnapshot(huge, { shared_plan_id: id(), version: 1, title: 'Huge plan', author: 'Jo' }, {
      userId: U, units: 'lb', increment: 5, exercises: [], gear: [], now: ts, newId: id,
    })).toThrow(ValidationError)
  })

  it('plan source title and author are cleaned and checked like any public text (imports)', () => {
    const base = { id: id(), name: 'P', archived: false, user_id: U, ...sync }
    const src = { shared_plan_id: id(), version: 1, title: 'Strong\u0000 5x5', author: 'Jo\u200b Lifts' }
    expect(planSchema.parse({ ...base, source: src }).source).toEqual({ ...src, title: 'Strong 5x5', author: 'Jo Lifts' })
    expect(planSchema.safeParse({ ...base, source: { ...src, title: 'Visit spam.com' } }).success).toBe(false)
    expect(planSchema.safeParse({ ...base, source: { ...src, author: 'x'.repeat(31) } }).success).toBe(false)
  })
})

describe('nameKey', () => {
  it('matches NFC/NFD, width, case and inner whitespace', () => {
    expect(nameKey('Cafe\u0301 Squat')).toBe(nameKey('Café squat'))
    expect(nameKey('  Bench   Press ')).toBe(nameKey('bench press'))
    expect(nameKey('Ｂｅｎｃｈ Press')).toBe('bench press')
  })
})

describe('snapshotFromPlanTree', () => {
  const barbell = gear('Barbell')
  const bench = gear('Bench')
  const press = exercise('Bench Press', { required_gear_ids: [barbell.id, bench.id], supports_angle: true, default_weight: 135 })
  const curl = exercise('Curl', { default_sets: 2, default_reps: 12, default_weight: 30 })

  it('keeps names, effective base values and the effective rule; nothing private', () => {
    const t = tree([
      { name: 'Push', color: 'red', items: [
        item(press, { angle: 'incline', amrap_last: true, sets: 4, effective: { sets: 4, baseReps: 6, baseWeight: 140, targetReps: 7, targetWeight: 150 } }),
        item(curl, { rule: null, ruleSource: 'item' }),
      ] },
      { name: 'Empty', items: [] },
    ])
    const snap = snapshotFromPlanTree(t, 'lb', [barbell, bench])
    expect(snap).toEqual({
      name: 'My Plan',
      units: 'lb',
      days: [
        {
          name: 'Push',
          color: 'red',
          items: [
            { exercise: 'Bench Press', gear: ['Barbell', 'Bench'], supports_angle: true, sets: 4, reps: 6, weight: 140, angle: 'incline', amrap_last: true, superset: null, rule: defaultRule(5) },
            { exercise: 'Curl', gear: [], supports_angle: false, sets: 2, reps: 12, weight: 30, angle: null, amrap_last: false, superset: null, rule: null },
          ],
        },
      ],
    })
    const text = JSON.stringify(snap)
    for (const secret of ['SECRET', 'video.example', U, t.id, press.id, barbell.id, ts, '999', '150']) {
      expect(text, secret).not.toContain(secret)
    }
  })

  it('letters supersets per day and drops a superset of one', () => {
    const g1 = id()
    const g2 = id()
    const t = tree([{ name: 'D', items: [
      item(curl, { superset_group: g2 }), item(press, { superset_group: g2 }), item(curl, { superset_group: g1 }),
    ] }])
    expect(snapshotFromPlanTree(t, 'kg', []).days[0]!.items.map((i) => i.superset)).toEqual(['A', 'A', null])
  })

  it('rejects a plan with no exercises and strips control characters from names', () => {
    expect(() => snapshotFromPlanTree(tree([{ name: 'D', items: [] }]), 'lb', [])).toThrow(ValidationError)
    const t = tree([{ name: 'Day\u0000 1', items: [item(exercise('Row\u0007'))] }])
    const snap = snapshotFromPlanTree(t, 'lb', [])
    expect(snap.days[0]!.name).toBe('Day 1')
    expect(snap.days[0]!.items[0]!.exercise).toBe('Row')
  })

  it('rejects too many days or items with a clear message', () => {
    const many = Array.from({ length: COMMUNITY.maxDays + 1 }, (_, i) => ({ name: `D${i}`, items: [item(curl)] }))
    expect(() => snapshotFromPlanTree(tree(many), 'lb', [])).toThrow(/days/)
    const crowded = [{ name: 'D', items: Array.from({ length: COMMUNITY.maxItemsPerDay + 1 }, () => item(curl)) }]
    expect(() => snapshotFromPlanTree(tree(crowded), 'lb', [])).toThrow(/exercises/)
  })
})

describe('sharedSnapshotSchema', () => {
  const valid: SharedSnapshot = {
    name: 'P', units: 'kg',
    days: [{ name: 'D', color: null, items: [
      { exercise: 'Squat', gear: [], supports_angle: false, sets: 3, reps: 5, weight: 100, angle: null, amrap_last: false, superset: 'A', rule: null },
      { exercise: 'Dip', gear: [], supports_angle: false, sets: 3, reps: 5, weight: 0, angle: null, amrap_last: false, superset: 'A', rule: null },
    ] }],
  }
  it('accepts a valid snapshot and rejects broken ones', () => {
    expect(sharedSnapshotSchema.safeParse(valid).success).toBe(true)
    const mutate = (fn: (s: SharedSnapshot) => void) => {
      const s = structuredClone(valid)
      fn(s)
      return sharedSnapshotSchema.safeParse(s).success
    }
    expect(mutate((s) => (s.days[0]!.items[1]!.superset = 'B'))).toBe(false) // superset of one
    expect(mutate((s) => (s.days[0]!.items[0]!.angle = 'flat'))).toBe(false) // angle without support
    expect(mutate((s) => (s.days[0]!.items[0]!.weight = 1e9))).toBe(false)
    expect(mutate((s) => (s.days = []))).toBe(false)
    expect(mutate((s) => (s.days[0]!.items[0]!.exercise = 'x'.repeat(201)))).toBe(false)
    expect(mutate((s) => ((s as unknown as { units: string }).units = 'stone'))).toBe(false)
  })
})

describe('planFromSnapshot', () => {
  const source: PlanSource = { shared_plan_id: id(), version: 3, title: 'Strong 5x5', author: 'Jo Lifts' }
  let k = 0
  const ctx = (over: Partial<AdoptContext> = {}): AdoptContext => ({
    userId: U, units: 'lb', increment: 5, exercises: [], gear: [], now: ts, newId: () => `10000000-0000-4000-8000-${String(++k).padStart(12, '0')}`,
    ...over,
  })
  const snap = (over: Partial<SharedSnapshot> = {}): SharedSnapshot => ({
    name: 'Shared plan', units: 'lb',
    days: [{ name: 'Push', color: 'blue', items: [
      { exercise: 'Bench Press', gear: ['Barbell', 'Bench'], supports_angle: true, sets: 3, reps: 5, weight: 135, angle: 'incline', amrap_last: true, superset: 'A', rule: { ...defaultRule(5), success_amount: 10 } },
      { exercise: 'Sled Push', gear: ['Sled'], supports_angle: false, sets: 4, reps: 20, weight: 90, angle: null, amrap_last: false, superset: 'A', rule: null },
      { exercise: 'Curl', gear: [], supports_angle: false, sets: 2, reps: 10, weight: 25, angle: null, amrap_last: false, superset: null, rule: { ...defaultRule(5), success_action: 'add_reps', success_amount: 1, rep_ceiling: 12 } },
    ] }],
    ...over,
  })

  it('reuses exercises and gear by case-insensitive name, creates the missing ones, never touches existing rows', () => {
    const barbell = gear('barbell')
    const myBench = exercise('BENCH PRESS', { supports_angle: false, default_weight: 50 })
    const before = structuredClone([barbell, myBench])
    const out = planFromSnapshot(snap(), source, ctx({ exercises: [myBench], gear: [barbell] }))
    expect([barbell, myBench]).toEqual(before)
    expect(out.plan).toMatchObject({ name: 'Shared plan', source, published: null, archived: false })
    // Gear is only needed for exercises that are created (a reused exercise keeps its own gear).
    expect(out.newGear.map((g) => [g.name, g.owned])).toEqual([['Sled', false]])
    expect(out.newExercises.map((e) => e.name)).toEqual(['Sled Push', 'Curl'])
    const sled = out.newExercises[0]!
    expect(sled).toMatchObject({ default_sets: 4, default_reps: 20, default_weight: 90, supports_angle: false, notes: '', video_url: null, default_rule: null })
    expect(sled.required_gear_ids).toEqual([out.newGear[0]!.id])
    const [a, b, c] = out.items
    expect(a).toMatchObject({ exercise_id: myBench.id, sets: 3, reps: 5, weight: 135, target_reps: null, target_weight: null, amrap_last: true, inherit_rule: true })
    // The existing exercise has no angle support: the angle is dropped, the exercise is left alone.
    expect(a!.angle).toBeNull()
    expect(a!.superset_group).not.toBeNull()
    expect(b!.superset_group).toBe(a!.superset_group)
    expect(c!.superset_group).toBeNull()
    expect(b).toMatchObject({ inherit_rule: false }) // rule null: explicit "no progression"
    expect(out.rules.map((r) => [r.plan_item_id, r.success_action, r.success_amount])).toEqual([
      [a!.id, 'add_weight', 10],
      [c!.id, 'add_reps', 1],
    ])
    expect(out.itemStates.map((s) => [s.plan_item_id, s.fail_streak])).toEqual(out.items.map((i) => [i.id, 0]))
    expect(out.days).toHaveLength(1)
    expect(out.days[0]).toMatchObject({ name: 'Push', color: 'blue', position: 0, plan_id: out.plan.id })
    const ids = new Set([out.plan.id, ...out.days.map((d) => d.id), ...out.items.map((i) => i.id), ...out.newGear.map((g) => g.id), ...out.newExercises.map((e) => e.id)])
    expect(ids.size).toBe(1 + 1 + 3 + 1 + 2)
  })

  it('matches NFC/NFD and spacing variants; variants inside one snapshot share one new exercise and merge gear; inactive exercises are reused as is', () => {
    const cafe = exercise('Cafe\u0301 Squat') // NFD
    const row = exercise('Row', { active: false })
    const s: SharedSnapshot = {
      name: 'Variants', units: 'lb',
      days: [{ name: 'D', color: null, items: [
        { exercise: 'Café Squat', gear: [], supports_angle: false, sets: 3, reps: 5, weight: 100, angle: null, amrap_last: false, superset: null, rule: null },
        { exercise: 'bench  press', gear: ['Bench'], supports_angle: false, sets: 3, reps: 5, weight: 100, angle: null, amrap_last: false, superset: null, rule: null },
        { exercise: 'Bench Press', gear: ['Barbell', 'bench'], supports_angle: true, sets: 3, reps: 5, weight: 100, angle: 'flat', amrap_last: false, superset: null, rule: null },
        { exercise: 'ROW', gear: ['Rower'], supports_angle: false, sets: 3, reps: 5, weight: 100, angle: null, amrap_last: false, superset: null, rule: null },
      ] }],
    }
    const out = planFromSnapshot(s, source, ctx({ exercises: [cafe, row] }))
    expect(out.items[0]!.exercise_id).toBe(cafe.id)
    expect(out.items[3]!.exercise_id).toBe(row.id)
    expect(row.active).toBe(false)
    expect(out.newExercises).toHaveLength(1)
    const bench = out.newExercises[0]!
    expect(out.items[1]!.exercise_id).toBe(bench.id)
    expect(out.items[2]!.exercise_id).toBe(bench.id)
    expect(bench.supports_angle).toBe(true)
    expect(out.items[2]!.angle).toBe('flat')
    expect(out.newGear.map((g) => g.name)).toEqual(['Bench', 'Barbell'])
    expect(bench.required_gear_ids).toEqual(out.newGear.map((g) => g.id))
  })

  it('a new exercise keeps angle support and the angle, and gets its gear (matched or created)', () => {
    const barbell = gear('BARBELL')
    const out = planFromSnapshot(snap(), source, ctx({ gear: [barbell] }))
    expect(out.newGear.map((g) => g.name)).toEqual(['Bench', 'Sled'])
    expect(out.newExercises.find((e) => e.name === 'Bench Press')).toMatchObject({ supports_angle: true, required_gear_ids: [barbell.id, out.newGear[0]!.id] })
    expect(out.items[0]!.angle).toBe('incline')
  })

  it('kg to lb and back: weights round to the step, add_weight amounts stay valid, add_reps untouched', () => {
    const kg = snap({ units: 'kg' })
    kg.days[0]!.items[0]!.weight = 100
    kg.days[0]!.items[0]!.rule = { ...defaultRule(2.5), success_amount: 2.5 }
    const toLb = planFromSnapshot(kg, source, ctx({ units: 'lb', increment: 5 }))
    expect(toLb.items[0]!.weight).toBe(220) // 220.46 -> nearest 5
    expect(toLb.rules[0]!.success_amount).toBe(5) // 5.51 lb -> 5, never below one step
    expect(toLb.rules[1]!).toMatchObject({ success_action: 'add_reps', success_amount: 1 })
    const lb = snap({ units: 'lb' })
    lb.days[0]!.items[0]!.weight = 220
    lb.days[0]!.items[0]!.rule = { ...defaultRule(5), success_amount: 5 }
    const toKg = planFromSnapshot(lb, source, ctx({ units: 'kg', increment: 2.5 }))
    expect(toKg.items[0]!.weight).toBe(100) // 99.79 -> nearest 2.5
    expect(toKg.rules[0]!.success_amount).toBe(2.5)
    const tiny = snap({ units: 'lb' })
    tiny.days[0]!.items[0]!.rule = { ...defaultRule(5), success_amount: 0.5 }
    expect(planFromSnapshot(tiny, source, ctx({ units: 'kg', increment: 2.5 })).rules[0]!.success_amount).toBe(2.5)
  })

  it('same units keep the numbers exactly', () => {
    const s = snap()
    s.days[0]!.items[0]!.weight = 137.5
    expect(planFromSnapshot(s, source, ctx({ increment: 5 })).items[0]!.weight).toBe(137.5)
  })

  it('rejects values that would be over the limit after conversion instead of clamping', () => {
    const s = snap({ units: 'kg' })
    s.days[0]!.items[0]!.weight = 90_000 // ~198,416 lb
    expect(() => planFromSnapshot(s, source, ctx({ units: 'lb' }))).toThrow(ValidationError)
  })

  it('rejects an invalid snapshot or source', () => {
    const s = snap()
    s.days[0]!.items[1]!.superset = null // leaves A with one member
    expect(() => planFromSnapshot(s, source, ctx())).toThrow(ValidationError)
    expect(() => planFromSnapshot(snap(), { ...source, version: 0 }, ctx())).toThrow(ValidationError)
  })
})

describe('public client', () => {
  type Call = { url: string; init?: RequestInit }
  function stub(status: number, body?: unknown) {
    const calls: Call[] = []
    const f = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return new Response(body === undefined ? null : JSON.stringify(body), { status })
    }) as unknown as typeof fetch
    return { calls, fetch: f }
  }
  const listing = { id: id(), title: 'Strong 5x5', description: '', level: null, author: 'Jo Lifts', day_count: 1, version: 1, upvotes: 0, downloads: 0, updated_at: ts }
  const snapshot: SharedSnapshot = {
    name: 'P', units: 'lb',
    days: [{ name: 'D', color: null, items: [{ exercise: 'Squat', gear: [], supports_angle: false, sets: 3, reps: 5, weight: 100, angle: null, amrap_last: false, superset: null, rule: null }] }],
  }

  it('builds the list query and parses the page', async () => {
    const s = stub(200, { items: [listing], next_cursor: null })
    const page = await fetchCommunityList({ q: 'a%b', days: 3, level: 'beginner', gear: 'none', sort: 'new', cursor: 'c1' }, { fetch: s.fetch, baseUrl: 'https://api.example.invalid/' })
    expect(page.items).toEqual([listing])
    const url = new URL(s.calls[0]!.url)
    expect(url.origin + url.pathname).toBe('https://api.example.invalid/api/public/plans')
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: 'a%b', days: '3', level: 'beginner', gear: 'none', sort: 'new', cursor: 'c1' })
    expect(s.calls[0]!.init?.credentials).toBe('omit')
  })

  it('fetches a plan (latest or one version) and maps errors like ApiRepo', async () => {
    const s = stub(200, { listing, version: 1, snapshot })
    expect((await fetchCommunityPlan(listing.id, { fetch: s.fetch })).snapshot).toEqual(snapshot)
    expect(s.calls[0]!.url).toBe(`/api/public/plans/${listing.id}`)
    await fetchCommunityPlan(listing.id, { fetch: s.fetch, version: 2 })
    expect(s.calls[1]!.url).toBe(`/api/public/plans/${listing.id}/versions/2`)
    await expect(fetchCommunityPlan(listing.id, { fetch: stub(404, { error: 'not_found' }).fetch })).rejects.toBeInstanceOf(NotFoundError)
    await expect(fetchCommunityList({}, { fetch: (async () => { throw new TypeError('x') }) as unknown as typeof fetch })).rejects.toBeInstanceOf(OfflineError)
    await expect(fetchCommunityList({}, { fetch: stub(500, { error: 'internal_error' }).fetch })).rejects.toBeInstanceOf(ApiError)
  })

  it('rejects a response that does not match the public shape (untrusted data)', async () => {
    const bad = { listing, version: 1, snapshot: { ...snapshot, days: [] } }
    await expect(fetchCommunityPlan(listing.id, { fetch: stub(200, bad).fetch })).rejects.toBeInstanceOf(ApiError)
    const extra = { items: [{ ...listing, owner_id: 'x' }], next_cursor: null }
    const page = await fetchCommunityList({}, { fetch: stub(200, extra).fetch })
    expect(page.items[0]).not.toHaveProperty('owner_id')
  })
})
