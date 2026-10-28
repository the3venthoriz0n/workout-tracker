import {
  DEFAULT_INCREMENT,
  convertWeight,
  progress,
  roundToIncrement,
  setLogSchema,
  workoutSessionSchema,
  SEED_GEAR,
  newId,
  ConflictError,
  LIMITS,
  NotFoundError,
  ValidationError,
  angleSchema,
  compareSetLogs,
  dayColorSchema,
  effectiveValues,
  groupProgressionByExercise,
  planSessionSets,
  resolveRule,
  ruleFieldsOf,
  itemStateSchema,
  planDaySchema,
  planItemSchema,
  planSchema,
  progressionRuleSchema,
  ruleInputSchema,
  exerciseInputSchema,
  exerciseSchema,
  gearSchema,
  profileSchema,
  seedExercises,
  UnauthenticatedError,
  displayNameSchema,
  planFromSnapshot,
  parseImport,
} from '@workout/shared'
import type {
  AdoptInput,
  ListingMeta,
  SharedListing,
  Angle,
  DayColor,
  Exercise,
  ExerciseInput,
  ExerciseProgression,
  Gear,
  Plan,
  PlanDay,
  PlanItem,
  Profile,
  RuleInput,
  RuleSource,
  SetLog,
  Units,
  WorkoutSession,
} from '@workout/shared'
import type { AppDb } from './db'
import { SessionInProgressError } from './types'
import type {
  ExportData,
  FinishSummary,
  PlanTree,
  ProgressionRow,
  Repo,
  SessionDetail,
} from './types'

const now = () => new Date().toISOString()
const nextPosition = (siblings: { position: number }[]) =>
  siblings.length === 0 ? 0 : Math.max(...siblings.map((s) => s.position)) + 1

export class LocalRepo implements Repo {
  constructor(private readonly db: AppDb) {}

  // Empty every table and re-seed: a fresh guest database. Used after a confirmed upload,
  // a confirmed discard and sign-out, so no account data lingers on the device.
  async reset(): Promise<void> {
    const d = this.db
    await d.transaction('rw', d.tables, async () => {
      await Promise.all(d.tables.map((t) => t.clear()))
    })
    await this.init()
  }

  async init(): Promise<void> {
    await this.db.transaction('rw', this.db.profile, this.db.gear, this.db.exercises, async () => {
      if ((await this.db.profile.count()) > 0) return
      const ts = now()
      const user_id = newId()
      const units: Units = 'lb'
      const profile = profileSchema.parse({
        user_id,
        plan: 'free',
        units,
        weight_increment: DEFAULT_INCREMENT[units],
        created_at: ts,
        updated_at: ts,
        deleted_at: null,
      })
      const gear = SEED_GEAR.map((name) =>
        gearSchema.parse({
          id: newId(),
          name,
          owned: true,
          user_id,
          created_at: ts,
          updated_at: ts,
          deleted_at: null,
        }),
      )
      const idsByName = new Map(gear.map((g) => [g.name, g.id]))
      const exercises = seedExercises(units, idsByName).map((input) =>
        exerciseSchema.parse({
          ...input,
          id: newId(),
          user_id,
          created_at: ts,
          updated_at: ts,
          deleted_at: null,
        }),
      )
      await this.db.profile.add(profile)
      await this.db.gear.bulkAdd(gear)
      await this.db.exercises.bulkAdd(exercises)
    })
  }

  async getProfile(): Promise<Profile> {
    const profile = await this.db.profile.toCollection().first()
    if (!profile) throw new Error('Profile missing: init() has not run')
    return profile
  }

  async listGear(): Promise<Gear[]> {
    return (await this.db.gear.toArray())
      .filter((g) => g.deleted_at === null)
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  async saveGear(input: { id?: string; name: string; owned: boolean }): Promise<Gear> {
    return this.db.transaction('rw', this.db.profile, this.db.gear, async () => {
      const existing = input.id ? await this.db.gear.get(input.id) : undefined
      const ts = now()
      const gear = gearSchema.parse(
        existing
          ? { ...existing, name: input.name, owned: input.owned, updated_at: ts }
          : {
              id: input.id ?? newId(),
              name: input.name,
              owned: input.owned,
              user_id: (await this.getProfile()).user_id,
              created_at: ts,
              updated_at: ts,
              deleted_at: null,
            },
      )
      await this.db.gear.put(gear)
      return gear
    })
  }

  async listExercises(): Promise<Exercise[]> {
    const all = await this.db.exercises.toArray()
    return all
      .filter((e) => e.deleted_at === null)
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  async saveExercise(input: ExerciseInput): Promise<Exercise> {
    const parsed = exerciseInputSchema.parse(input)
    const { profile, exercises, planItems } = this.db
    return this.db.transaction('rw', profile, exercises, planItems, async () => {
      const existing = parsed.id ? await this.db.exercises.get(parsed.id) : undefined
      const ts = now()
      // Not mentioning supports_angle keeps the stored value.
      const supports_angle = parsed.supports_angle ?? existing?.supports_angle ?? false
      const exercise = exerciseSchema.parse(
        existing
          ? { ...existing, ...parsed, supports_angle, id: existing.id, updated_at: ts }
          : {
              ...parsed,
              supports_angle,
              id: parsed.id ?? newId(),
              user_id: (await this.getProfile()).user_id,
              created_at: ts,
              updated_at: ts,
              deleted_at: null,
            },
      )
      await this.db.exercises.put(exercise)
      if (existing && existing.deleted_at === null && !supports_angle) {
        // Turning angle support off clears the angle of the exercise's live items.
        await planItems
          .where('exercise_id')
          .equals(exercise.id)
          .filter((i) => i.deleted_at === null && i.angle !== null)
          .modify({ angle: null, updated_at: ts })
      }
      return exercise
    })
  }

  async setExerciseRule(exerciseId: string, rule: RuleInput | null): Promise<void> {
    const parsed = rule === null ? null : ruleInputSchema.parse(rule)
    await this.db.transaction('rw', this.db.exercises, async () => {
      const existing = await this.db.exercises.get(exerciseId)
      if (!existing || existing.deleted_at !== null) throw new NotFoundError('Exercise')
      await this.db.exercises.put(exerciseSchema.parse({ ...existing, default_rule: parsed, updated_at: now() }))
    })
  }

  async deleteExercise(id: string): Promise<void> {
    await this.db.transaction('rw', this.db.exercises, this.db.planItems, async () => {
      const existing = await this.db.exercises.get(id)
      if (!existing || existing.deleted_at !== null) return
      const ts = now()
      const items = await this.db.planItems
        .where('exercise_id')
        .equals(id)
        .filter((item) => item.deleted_at === null)
        .toArray()
      for (const item of items) await this.softDeleteItem(item, ts)
      await this.db.exercises.put({ ...existing, deleted_at: ts, updated_at: ts })
    })
  }

  async exerciseUsage(id: string): Promise<{ planItemCount: number; plans: string[] }> {
    const items = await this.db.planItems
      .where('exercise_id')
      .equals(id)
      .filter((item) => item.deleted_at === null)
      .toArray()
    const names = new Set<string>()
    let planItemCount = 0
    for (const item of items) {
      const day = await this.db.planDays.get(item.plan_day_id)
      const plan = day && day.deleted_at === null ? await this.db.plans.get(day.plan_id) : undefined
      if (plan && plan.deleted_at === null) {
        names.add(plan.name)
        planItemCount++
      }
    }
    return { planItemCount, plans: [...names].sort((a, b) => a.localeCompare(b)) }
  }

  async deleteGear(id: string): Promise<void> {
    await this.db.transaction('rw', this.db.gear, this.db.exercises, async () => {
      const existing = await this.db.gear.get(id)
      if (!existing || existing.deleted_at !== null) return
      const ts = now()
      const exercises = await this.db.exercises.toArray()
      for (const ex of exercises) {
        if (ex.deleted_at === null && ex.required_gear_ids.includes(id)) {
          await this.db.exercises.put({
            ...ex,
            required_gear_ids: ex.required_gear_ids.filter((g) => g !== id),
            updated_at: ts,
          })
        }
      }
      await this.db.gear.put({ ...existing, deleted_at: ts, updated_at: ts })
    })
  }

  // Shared per-item cleanup for deletePlanItem and deleteExercise (keep them consistent).
  private async softDeleteItem(item: PlanItem, ts: string): Promise<void> {
    await this.db.planItems.put({ ...item, superset_group: null, deleted_at: ts, updated_at: ts })
    if (item.superset_group !== null) await this.dissolveIfAlone(item.plan_day_id, item.superset_group, ts)
  }

  // A superset needs two live members; a group left with one is dissolved.
  private async dissolveIfAlone(planDayId: string, group: string, ts: string): Promise<void> {
    const left = (await this.db.planItems.where('plan_day_id').equals(planDayId).toArray()).filter(
      (i) => i.deleted_at === null && i.superset_group === group,
    )
    if (left.length === 1) await this.db.planItems.put({ ...left[0]!, superset_group: null, updated_at: ts })
  }

  async updateProfile(patch: {
    units?: Units
    weight_increment?: number
    default_rule?: RuleInput
    display_name?: string
  }): Promise<Profile> {
    if (patch.weight_increment !== undefined && !(patch.weight_increment > 0)) {
      throw new Error('weight_increment must be greater than 0')
    }
    let displayName: string | undefined
    if (patch.display_name !== undefined) {
      const r = displayNameSchema.safeParse(patch.display_name)
      if (!r.success) throw new ValidationError('display_name', r.error.issues[0]?.message ?? 'Invalid public name')
      displayName = r.data
    }
    const d = this.db
    return d.transaction('rw', [d.profile, d.exercises, d.planItems, d.setLogs, d.rules], async () => {
      const current = await this.getProfile()
      const ts = now()
      const next = { ...current, updated_at: ts }
      if (patch.units !== undefined && patch.units !== current.units) {
        const from = current.units
        const to = patch.units
        const conv = (w: number) => convertWeight(w, from, to)
        const convNull = (w: number | null) => (w === null ? null : conv(w))
        next.units = to
        next.weight_increment = DEFAULT_INCREMENT[to]
        const newIncrement = DEFAULT_INCREMENT[to]
        const convAmount = (amount: number) =>
          Math.min(
            LIMITS.weight,
            amount === current.weight_increment
              ? newIncrement
              : Math.max(newIncrement, roundToIncrement(conv(amount), newIncrement)),
          )
        await d.exercises.toCollection().modify((e) => {
          e.default_weight = conv(e.default_weight)
          if (e.default_rule?.success_action === 'add_weight') {
            e.default_rule = { ...e.default_rule, success_amount: convAmount(e.default_rule.success_amount) }
          }
          e.updated_at = ts
        })
        await d.planItems.toCollection().modify((i) => {
          i.weight = convNull(i.weight)
          i.target_weight = convNull(i.target_weight)
          i.updated_at = ts
        })
        await d.setLogs.toCollection().modify((l) => {
          l.weight = conv(l.weight)
          l.target_weight = conv(l.target_weight)
          l.updated_at = ts
        })
        await d.rules.toCollection().modify((r) => {
          if (r.success_action !== 'add_weight') return
          r.success_amount = convAmount(r.success_amount)
          r.updated_at = ts
        })
        if (current.default_rule?.success_action === 'add_weight') {
          next.default_rule = {
            ...current.default_rule,
            success_amount: convAmount(current.default_rule.success_amount),
          }
        }
      }
      if (patch.weight_increment !== undefined) next.weight_increment = patch.weight_increment
      if (patch.default_rule !== undefined) next.default_rule = ruleInputSchema.parse(patch.default_rule)
      if (displayName !== undefined) next.display_name = displayName
      const profile = profileSchema.parse(next)
      await d.profile.put(profile)
      return profile
    })
  }

  async listPlans(): Promise<Plan[]> {
    return (await this.db.plans.toArray())
      .filter((p) => p.deleted_at === null)
      .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.name.localeCompare(b.name))
  }

  // Effective rule of an item (spec §6 layering).
  private async ruleOf(
    item: PlanItem,
    exercise: Exercise,
    profile: Profile,
  ): Promise<{ rule: RuleInput | null; source: RuleSource }> {
    const row = await this.db.rules.get(item.id)
    return resolveRule({
      itemRule: row ? ruleFieldsOf(row) : null,
      inherit: item.inherit_rule,
      exerciseRule: exercise.default_rule,
      profileRule: profile.default_rule,
      increment: profile.weight_increment,
    })
  }

  async getPlan(id: string): Promise<PlanTree | undefined> {
    const plan = await this.db.plans.get(id)
    if (!plan || plan.deleted_at !== null) return undefined
    const profile = await this.getProfile()
    const byPosition = <T extends { position: number }>(a: T, b: T) => a.position - b.position
    const days = (await this.db.planDays.where('plan_id').equals(id).toArray())
      .filter((d) => d.deleted_at === null)
      .sort(byPosition)
    const tree: PlanTree['days'] = []
    for (const day of days) {
      const items = (await this.db.planItems.where('plan_day_id').equals(day.id).toArray())
        .filter((i) => i.deleted_at === null)
        .sort(byPosition)
      const full: PlanTree['days'][number]['items'] = []
      for (const item of items) {
        const exercise = await this.db.exercises.get(item.exercise_id)
        if (!exercise) continue
        const { rule, source } = await this.ruleOf(item, exercise, profile)
        full.push({ ...item, exercise, rule, ruleSource: source, effective: effectiveValues(item, exercise) })
      }
      tree.push({ ...day, items: full })
    }
    return { ...plan, days: tree }
  }

  async savePlan(input: { id?: string; name: string }): Promise<Plan> {
    return this.db.transaction('rw', this.db.profile, this.db.plans, async () => {
      const existing = input.id ? await this.db.plans.get(input.id) : undefined
      const ts = now()
      const plan = planSchema.parse(
        existing
          ? { ...existing, name: input.name, updated_at: ts }
          : {
              id: input.id ?? newId(),
              name: input.name,
              archived: false,
              user_id: (await this.getProfile()).user_id,
              created_at: ts,
              updated_at: ts,
              deleted_at: null,
            },
      )
      await this.db.plans.put(plan)
      return plan
    })
  }

  async deletePlan(id: string): Promise<void> {
    const { plans, planDays, planItems } = this.db
    await this.db.transaction('rw', plans, planDays, planItems, async () => {
      const plan = await plans.get(id)
      if (!plan || plan.deleted_at !== null) return
      const ts = now()
      await plans.put({ ...plan, deleted_at: ts, updated_at: ts })
      for (const day of await planDays.where('plan_id').equals(id).toArray()) {
        if (day.deleted_at === null) await planDays.put({ ...day, deleted_at: ts, updated_at: ts })
        await this.softDeleteItems(day.id, ts)
      }
    })
  }

  async savePlanDay(input: { id?: string; plan_id: string; name: string; color?: DayColor | null }): Promise<PlanDay> {
    const color = input.color === undefined ? undefined : dayColorSchema.nullable().parse(input.color)
    return this.db.transaction('rw', this.db.profile, this.db.planDays, async () => {
      const existing = input.id ? await this.db.planDays.get(input.id) : undefined
      const ts = now()
      let day: PlanDay
      if (existing) {
        day = planDaySchema.parse({ ...existing, name: input.name, color: color === undefined ? existing.color : color, updated_at: ts })
      } else {
        const siblings = (await this.db.planDays.where('plan_id').equals(input.plan_id).toArray()).filter(
          (d) => d.deleted_at === null,
        )
        day = planDaySchema.parse({
          id: input.id ?? newId(),
          plan_id: input.plan_id,
          name: input.name,
          position: nextPosition(siblings),
          color: color ?? null,
          created_at: ts,
          updated_at: ts,
          deleted_at: null,
        })
      }
      await this.db.planDays.put(day)
      return day
    })
  }

  async deletePlanDay(id: string): Promise<void> {
    await this.db.transaction('rw', this.db.planDays, this.db.planItems, async () => {
      const day = await this.db.planDays.get(id)
      if (!day || day.deleted_at !== null) return
      const ts = now()
      await this.db.planDays.put({ ...day, deleted_at: ts, updated_at: ts })
      await this.softDeleteItems(id, ts)
    })
  }

  private async softDeleteItems(planDayId: string, ts: string): Promise<void> {
    for (const item of await this.db.planItems.where('plan_day_id').equals(planDayId).toArray()) {
      if (item.deleted_at === null) await this.softDeleteItem(item, ts)
    }
  }

  async addPlanItem(planDayId: string, exerciseId: string): Promise<PlanItem> {
    const { profile, planItems, itemStates } = this.db
    return this.db.transaction('rw', profile, planItems, itemStates, async () => {
      const ts = now()
      const siblings = (await planItems.where('plan_day_id').equals(planDayId).toArray()).filter(
        (i) => i.deleted_at === null,
      )
      const item = planItemSchema.parse({
        id: newId(),
        plan_day_id: planDayId,
        exercise_id: exerciseId,
        position: nextPosition(siblings),
        sets: null,
        reps: null,
        weight: null,
        target_reps: null,
        target_weight: null,
        // No rule row: the item inherits its rule (spec §6) until setRule overrides it.
        inherit_rule: true,
        created_at: ts,
        updated_at: ts,
        deleted_at: null,
      })
      const base = { plan_item_id: item.id, created_at: ts, updated_at: ts, deleted_at: null }
      await planItems.add(item)
      await itemStates.add(itemStateSchema.parse({ ...base, fail_streak: 0 }))
      return item
    })
  }

  async updatePlanItem(
    id: string,
    patch: { sets?: number | null; reps?: number | null; weight?: number | null; angle?: Angle | null; amrap_last?: boolean },
  ): Promise<PlanItem> {
    const angle = patch.angle === undefined ? undefined : angleSchema.nullable().parse(patch.angle)
    const { planItems, itemStates, exercises } = this.db
    return this.db.transaction('rw', planItems, itemStates, exercises, async () => {
      const existing = await this.db.planItems.get(id)
      if (!existing || existing.deleted_at !== null) throw new Error('Plan item not found')
      const ts = now()
      const next = { ...existing, updated_at: ts }
      if (angle !== undefined && angle !== null && !(await exercises.get(existing.exercise_id))?.supports_angle) {
        throw new ValidationError('angle', 'This exercise does not support an angle')
      }
      if (angle !== undefined) next.angle = angle
      if (patch.amrap_last !== undefined) next.amrap_last = patch.amrap_last
      if (patch.sets !== undefined) next.sets = patch.sets
      if (patch.reps !== undefined) next.reps = patch.reps
      if (patch.weight !== undefined) next.weight = patch.weight
      if (patch.reps !== undefined || patch.weight !== undefined) {
        next.target_reps = null
        next.target_weight = null
        const state = await this.db.itemStates.get(id)
        if (state) await this.db.itemStates.put({ ...state, fail_streak: 0, updated_at: ts })
      }
      const item = planItemSchema.parse(next)
      await this.db.planItems.put(item)
      return item
    })
  }

  async deletePlanItem(id: string): Promise<void> {
    await this.db.transaction('rw', this.db.planItems, async () => {
      const item = await this.db.planItems.get(id)
      if (!item || item.deleted_at !== null) return
      await this.softDeleteItem(item, now())
    })
  }

  async setRule(planItemId: string, rule: RuleInput | null): Promise<void> {
    const parsed = rule === null ? null : ruleInputSchema.parse(rule)
    await this.db.transaction('rw', this.db.rules, this.db.planItems, async () => {
      if (parsed === null) {
        // An explicit "no progression" override.
        await this.db.rules.delete(planItemId)
        const item = await this.db.planItems.get(planItemId)
        if (item && item.inherit_rule) await this.db.planItems.put({ ...item, inherit_rule: false, updated_at: now() })
        return
      }
      const existing = await this.db.rules.get(planItemId)
      const ts = now()
      await this.db.rules.put(
        progressionRuleSchema.parse({
          ...parsed,
          plan_item_id: planItemId,
          created_at: existing?.created_at ?? ts,
          updated_at: ts,
          deleted_at: null,
        }),
      )
    })
  }

  async clearRule(planItemId: string): Promise<void> {
    await this.db.transaction('rw', this.db.rules, this.db.planItems, async () => {
      const item = await this.db.planItems.get(planItemId)
      if (!item || item.deleted_at !== null) throw new NotFoundError('Plan item')
      await this.db.rules.delete(planItemId)
      if (!item.inherit_rule) await this.db.planItems.put({ ...item, inherit_rule: true, updated_at: now() })
    })
  }

  async setSuperset(planDayId: string, groupId: string, itemIds: string[] | null): Promise<void> {
    const { plans, planDays, planItems } = this.db
    await this.db.transaction('rw', plans, planDays, planItems, async () => {
      const day = await planDays.get(planDayId)
      const plan = day && day.deleted_at === null ? await plans.get(day.plan_id) : undefined
      if (!day || !plan || plan.deleted_at !== null) throw new NotFoundError('Plan day')
      const ts = now()
      const all = await planItems.toArray()
      const live = all.filter((i) => i.deleted_at === null)
      if (live.some((i) => i.superset_group === groupId && i.plan_day_id !== planDayId)) {
        throw new ConflictError('Superset group is in use on another day')
      }
      const current = live.filter((i) => i.superset_group === groupId)
      if (itemIds === null) {
        for (const i of current) await planItems.put({ ...i, superset_group: null, updated_at: ts })
        return
      }
      checkSupersetIds(itemIds)
      const members: PlanItem[] = []
      for (const itemId of itemIds) {
        const item = live.find((i) => i.id === itemId)
        if (!item) throw new NotFoundError('Plan item')
        if (item.plan_day_id !== planDayId) throw new ValidationError('item_ids', 'Superset items must be in the same day')
        members.push(item)
      }
      const touched = new Set<string>()
      for (const i of current) {
        if (!itemIds.includes(i.id)) await planItems.put({ ...i, superset_group: null, updated_at: ts })
      }
      for (const m of members) {
        if (m.superset_group !== null && m.superset_group !== groupId) touched.add(m.superset_group)
        await planItems.put({ ...m, superset_group: groupId, updated_at: ts })
      }
      for (const g of touched) await this.dissolveIfAlone(planDayId, g, ts)
    })
  }

  async move(kind: 'day' | 'item', id: string, direction: -1 | 1): Promise<void> {
    const { planDays, planItems } = this.db
    await this.db.transaction('rw', planDays, planItems, async () => {
      const row = await (kind === 'day' ? planDays : planItems).get(id)
      if (!row || row.deleted_at !== null) return
      const siblings = (
        kind === 'day'
          ? await planDays.where('plan_id').equals((row as PlanDay).plan_id).toArray()
          : await planItems.where('plan_day_id').equals((row as PlanItem).plan_day_id).toArray()
      )
        .filter((r) => r.deleted_at === null)
        .sort((a, b) => a.position - b.position)
      const index = siblings.findIndex((r) => r.id === id)
      const other = siblings[index + direction]
      if (index < 0 || !other) return
      const ts = now()
      const swapped = [
        { ...row, position: other.position, updated_at: ts },
        { ...other, position: row.position, updated_at: ts },
      ]
      if (kind === 'day') await planDays.bulkPut(swapped as PlanDay[])
      else await planItems.bulkPut(swapped as PlanItem[])
    })
  }

  async getActiveSession(): Promise<SessionDetail | undefined> {
    const active = (await this.db.sessions.toArray()).find(
      (s) => s.completed_at === null && s.deleted_at === null,
    )
    return active ? this.sessionDetail(active) : undefined
  }

  private async sessionDetail(session: WorkoutSession): Promise<SessionDetail> {
    const logs = (await this.db.setLogs.where('session_id').equals(session.id).toArray()).sort(compareSetLogs)
    const groups = new Map<string, SetLog[]>()
    for (const log of logs) {
      const group = groups.get(log.plan_item_id)
      if (group) group.push(log)
      else groups.set(log.plan_item_id, [log])
    }
    const exercises: SessionDetail['exercises'] = []
    for (const [plan_item_id, sets] of groups) {
      const first = sets[0]
      if (!first) continue
      const exercise = await this.db.exercises.get(first.exercise_id)
      exercises.push({
        plan_item_id,
        exercise_id: first.exercise_id,
        exercise_name: first.exercise_name,
        video_url: exercise?.video_url ?? null,
        notes: exercise?.notes ?? '',
        sets: sets.sort((a, b) => a.set_no - b.set_no),
      })
    }
    return { ...session, exercises }
  }

  async startSession(planDayId: string): Promise<SessionDetail> {
    const { profile, sessions, setLogs, plans, planDays, planItems, exercises } = this.db
    const id = await this.db.transaction(
      'rw',
      [profile, sessions, setLogs, plans, planDays, planItems, exercises],
      async () => {
        if ((await sessions.toArray()).some((s) => s.completed_at === null && s.deleted_at === null)) {
          throw new SessionInProgressError('A session is already in progress')
        }
        const day = await planDays.get(planDayId)
        if (!day || day.deleted_at !== null) throw new Error('Plan day not found')
        const plan = await plans.get(day.plan_id)
        if (!plan || plan.deleted_at !== null) throw new Error('Plan not found')
        const user_id = (await this.getProfile()).user_id
        const ts = now()
        const session = workoutSessionSchema.parse({
          id: newId(),
          plan_day_id: day.id,
          plan_name: plan.name,
          day_name: day.name,
          started_at: ts,
          completed_at: null,
          note: '',
          user_id,
          created_at: ts,
          updated_at: ts,
          deleted_at: null,
        })
        const items = (await planItems.where('plan_day_id').equals(day.id).toArray())
          .filter((i) => i.deleted_at === null)
          .sort((a, b) => a.position - b.position)
        const rows: { item: PlanItem; exercise: Exercise; eff: ReturnType<typeof effectiveValues> }[] = []
        for (const item of items) {
          const exercise = await exercises.get(item.exercise_id)
          if (!exercise) continue
          rows.push({ item, exercise, eff: effectiveValues(item, exercise) })
        }
        const byId = new Map(rows.map((r) => [r.item.id, r]))
        const layout = planSessionSets(rows.map((r) => ({ ...r.item, sets: r.eff.sets })))
        const logs: SetLog[] = layout.map((slot) => {
          const { item, exercise, eff } = byId.get(slot.plan_item_id)!
          return setLogSchema.parse({
            id: newId(),
            session_id: session.id,
            plan_item_id: item.id,
            exercise_id: exercise.id,
            exercise_name: exercise.name,
            set_no: slot.set_no,
            position: item.position,
            target_reps: eff.targetReps,
            target_weight: eff.targetWeight,
            actual_reps: eff.targetReps,
            weight: eff.targetWeight,
            done: false,
            note: '',
            angle: item.angle,
            amrap: item.amrap_last && slot.set_no === eff.sets,
            seq: slot.seq,
            superset_group: slot.superset_group,
            superset_label: slot.superset_label,
            created_at: ts,
            updated_at: ts,
            deleted_at: null,
          })
        })
        await sessions.add(session)
        await setLogs.bulkAdd(logs)
        return session.id
      },
    )
    const created = await this.getSession(id)
    if (!created) throw new Error('Session missing after start')
    return created
  }

  async updateSet(
    id: string,
    patch: { done?: boolean; actual_reps?: number; weight?: number; note?: string },
  ): Promise<SetLog> {
    return this.db.transaction('rw', this.db.setLogs, async () => {
      const existing = await this.db.setLogs.get(id)
      if (!existing) throw new Error('Set not found')
      const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
      const next = setLogSchema.parse({ ...existing, ...defined, updated_at: now() })
      await this.db.setLogs.put(next)
      return next
    })
  }

  async updateSessionNote(id: string, note: string): Promise<void> {
    await this.db.transaction('rw', this.db.sessions, async () => {
      const session = await this.db.sessions.get(id)
      if (!session) throw new Error('Session not found')
      await this.db.sessions.put({ ...session, note, updated_at: now() })
    })
  }

  async finishSession(id: string): Promise<FinishSummary> {
    const { profile, sessions, setLogs, planItems, exercises, rules, itemStates } = this.db
    return this.db.transaction(
      'rw',
      [profile, sessions, setLogs, planItems, exercises, rules, itemStates],
      async () => {
        const session = await sessions.get(id)
        if (!session) throw new Error('Session not found')
        if (session.completed_at !== null) throw new Error('Session already completed')
        const detail = await this.sessionDetail(session)
        const prof = await this.getProfile()
        const increment = prof.weight_increment
        const ts = now()
        const summary: FinishSummary = []
        for (const group of detail.exercises) {
          const first = group.sets[0]
          if (!first) continue
          const item = await planItems.get(group.plan_item_id)
          const exercise = item && item.deleted_at === null ? await exercises.get(item.exercise_id) : undefined
          if (!item || item.deleted_at !== null || !exercise) {
            const snap = { reps: first.target_reps, weight: first.target_weight }
            summary.push({
              exercise_name: group.exercise_name,
              outcome: 'skipped',
              before: snap,
              after: { ...snap },
            })
            continue
          }
          const eff = effectiveValues(item, exercise)
          const { rule } = await this.ruleOf(item, exercise, prof)
          const state = await itemStates.get(item.id)
          const result = progress(
            {
              targetReps: eff.targetReps,
              targetWeight: eff.targetWeight,
              baseReps: eff.baseReps,
              plannedSets: eff.sets,
            },
            rule,
            state?.fail_streak ?? 0,
            group.sets,
            increment,
          )
          // Spec §6 step 1: a skipped item changes nothing
          if (result.outcome !== 'skipped') {
            await planItems.put({
              ...item,
              target_reps: result.targetReps,
              target_weight: result.targetWeight,
              updated_at: ts,
            })
            await itemStates.put(
              itemStateSchema.parse({
                plan_item_id: item.id,
                fail_streak: result.failStreak,
                created_at: state?.created_at ?? ts,
                updated_at: ts,
                deleted_at: null,
              }),
            )
          }
          summary.push({
            exercise_name: group.exercise_name,
            outcome: result.outcome,
            before: { reps: eff.targetReps, weight: eff.targetWeight },
            after: { reps: result.targetReps, weight: result.targetWeight },
          })
        }
        await sessions.put({ ...session, completed_at: ts, updated_at: ts })
        return summary
      },
    )
  }

  async discardSession(id: string): Promise<void> {
    await this.db.transaction('rw', this.db.sessions, this.db.setLogs, async () => {
      const session = await this.db.sessions.get(id)
      if (session && session.completed_at !== null) throw new Error('Cannot discard a completed session')
      await this.db.setLogs.where('session_id').equals(id).delete()
      await this.db.sessions.delete(id)
    })
  }

  async listSessions(): Promise<WorkoutSession[]> {
    return (await this.db.sessions.toArray())
      .filter((s) => s.completed_at !== null && s.deleted_at === null)
      .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))
  }

  async getSession(id: string): Promise<SessionDetail | undefined> {
    const session = await this.db.sessions.get(id)
    if (!session || session.deleted_at !== null) return undefined
    return this.sessionDetail(session)
  }

  async exportAll(): Promise<ExportData> {
    const d = this.db
    return d.transaction('r', d.tables, async () => ({
      version: 1 as const,
      exported_at: now(),
      profile: await this.getProfile(),
      gear: await d.gear.toArray(),
      exercises: await d.exercises.toArray(),
      plans: await d.plans.toArray(),
      plan_days: await d.planDays.toArray(),
      plan_items: await d.planItems.toArray(),
      progression_rules: await d.rules.toArray(),
      item_states: await d.itemStates.toArray(),
      workout_sessions: await d.sessions.toArray(),
      set_logs: await d.setLogs.toArray(),
    }))
  }

  /**
   * Restore from a file: REPLACES everything on the device with it (spec §7). Validated first with
   * the server's own rules (`parseImport`: schema, public text, references, angles), so a bad file
   * throws ImportInvalidError and changes nothing; then every store is cleared and refilled in ONE
   * Dexie transaction. Ids and timestamps are kept; every row gets this device's guest id. The tier
   * is always free and a plan is never published here; an existing public name wins over the file's.
   */
  async importAll(raw: unknown): Promise<void> {
    const data = parseImport(raw)
    const d = this.db
    await d.transaction('rw', d.tables, async () => {
      const current = await d.profile.toCollection().first()
      const user_id = current?.user_id ?? newId()
      const own = <T extends object>(rows: T[]): (T & { user_id: string })[] => rows.map((r) => ({ ...r, user_id }))
      await Promise.all(d.tables.map((t) => t.clear()))
      await d.profile.add({
        ...data.profile,
        user_id,
        plan: 'free',
        display_name: current?.display_name ?? data.profile.display_name,
      })
      await d.gear.bulkAdd(own(data.gear))
      await d.exercises.bulkAdd(own(data.exercises))
      await d.plans.bulkAdd(own(data.plans).map((p) => ({ ...p, published: null })))
      await d.planDays.bulkAdd(own(data.plan_days))
      await d.planItems.bulkAdd(own(data.plan_items))
      await d.rules.bulkAdd(own(data.progression_rules))
      await d.itemStates.bulkAdd(own(data.item_states))
      await d.sessions.bulkAdd(own(data.workout_sessions))
      await d.setLogs.bulkAdd(own(data.set_logs))
    })
  }

  async listProgression(): Promise<ProgressionRow[]> {
    const d = this.db
    return d.transaction('r', [d.profile, d.plans, d.planDays, d.planItems, d.exercises, d.rules], async () => {
      const profile = await this.getProfile()
      const byPosition = <T extends { position: number }>(a: T, b: T) => a.position - b.position
      const rows: ProgressionRow[] = []
      for (const plan of await this.listPlans()) {
        const days = (await d.planDays.where('plan_id').equals(plan.id).toArray())
          .filter((x) => x.deleted_at === null)
          .sort(byPosition)
        for (const day of days) {
          const items = (await d.planItems.where('plan_day_id').equals(day.id).toArray())
            .filter((i) => i.deleted_at === null)
            .sort(byPosition)
          for (const item of items) {
            const exercise = await d.exercises.get(item.exercise_id)
            if (!exercise) continue
            const { rule, source } = await this.ruleOf(item, exercise, profile)
            rows.push({
              plan_id: plan.id,
              plan_name: plan.name,
              day_id: day.id,
              day_name: day.name,
              item_id: item.id,
              exercise_id: exercise.id,
              exercise_name: exercise.name,
              rule,
              ruleSource: source,
            })
          }
        }
      }
      return rows
    })
  }

  // Community plans: guests have no account, so they cannot publish or vote (spec §3).
  async publishPlan(_planId: string, _meta: ListingMeta): Promise<{ shared_plan_id: string; version: number }> {
    throw new UnauthenticatedError()
  }

  async unpublishPlan(_planId: string): Promise<void> {
    throw new UnauthenticatedError()
  }

  async listMyShared(): Promise<SharedListing[]> {
    return []
  }

  async setVote(_sharedPlanId: string, _voted: boolean): Promise<{ upvotes: number }> {
    throw new UnauthenticatedError()
  }

  async hasVoted(_sharedPlanId: string): Promise<boolean> {
    return false
  }

  /**
   * A local copy from the snapshot the guest fetched from the public API (with its listing's
   * title and author). Nothing is counted for guests. All rows are written in one transaction.
   */
  async adoptSharedPlan(input: AdoptInput): Promise<{ plan_id: string }> {
    if (input.snapshot === undefined) throw new ValidationError('snapshot', 'A guest copy needs the shared snapshot')
    const source = { shared_plan_id: input.shared_plan_id, version: input.version, title: input.title, author: input.author }
    const d = this.db
    const tables = [d.profile, d.gear, d.exercises, d.plans, d.planDays, d.planItems, d.rules, d.itemStates]
    return d.transaction('rw', tables, async () => {
      const profile = await this.getProfile()
      const rows = planFromSnapshot(input.snapshot, source, {
        userId: profile.user_id,
        units: profile.units,
        increment: profile.weight_increment,
        exercises: await d.exercises.toArray(),
        gear: await d.gear.toArray(),
        now: now(),
        newId,
      })
      await d.gear.bulkAdd(rows.newGear)
      await d.exercises.bulkAdd(rows.newExercises)
      await d.plans.add(rows.plan)
      await d.planDays.bulkAdd(rows.days)
      await d.planItems.bulkAdd(rows.items)
      await d.rules.bulkAdd(rows.rules)
      await d.itemStates.bulkAdd(rows.itemStates)
      return { plan_id: rows.plan.id }
    })
  }

  async listProgressionByExercise(): Promise<ExerciseProgression[]> {
    const d = this.db
    return d.transaction('r', [d.profile, d.plans, d.planDays, d.planItems, d.exercises, d.rules], async () =>
      groupProgressionByExercise(await this.listExercises(), await this.listProgression(), await this.getProfile()),
    )
  }
}

function checkSupersetIds(itemIds: string[]): void {
  if (itemIds.length < LIMITS.supersetMin || itemIds.length > LIMITS.supersetMax) {
    throw new ValidationError('item_ids', `A superset has ${LIMITS.supersetMin} to ${LIMITS.supersetMax} items`)
  }
  if (new Set(itemIds).size !== itemIds.length) throw new ValidationError('item_ids', 'Duplicate item')
}
