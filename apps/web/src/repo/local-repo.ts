import {
  DEFAULT_INCREMENT,
  convertWeight,
  progress,
  roundToIncrement,
  setLogSchema,
  workoutSessionSchema,
  SEED_GEAR,
  newId,
  defaultRule,
  effectiveValues,
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
} from '@workout/shared'
import type {
  Exercise,
  ExerciseInput,
  Gear,
  Plan,
  PlanDay,
  PlanItem,
  Profile,
  RuleInput,
  SetLog,
  Units,
  WorkoutSession,
} from '@workout/shared'
import type { AppDb } from './db'
import { ExerciseInUseError, SessionInProgressError } from './types'
import type { ExportData, FinishSummary, PlanTree, Repo, SessionDetail } from './types'

const now = () => new Date().toISOString()
const nextPosition = (siblings: { position: number }[]) =>
  siblings.length === 0 ? 0 : Math.max(...siblings.map((s) => s.position)) + 1

export class LocalRepo implements Repo {
  constructor(private readonly db: AppDb) {}

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
    return this.db.transaction('rw', this.db.profile, this.db.exercises, async () => {
      const existing = parsed.id ? await this.db.exercises.get(parsed.id) : undefined
      const ts = now()
      const exercise = exerciseSchema.parse(
        existing
          ? { ...existing, ...parsed, id: existing.id, updated_at: ts }
          : {
              ...parsed,
              id: parsed.id ?? newId(),
              user_id: (await this.getProfile()).user_id,
              created_at: ts,
              updated_at: ts,
              deleted_at: null,
            },
      )
      await this.db.exercises.put(exercise)
      return exercise
    })
  }

  async deleteExercise(id: string): Promise<void> {
    await this.db.transaction('rw', this.db.exercises, this.db.planItems, async () => {
      const used = await this.db.planItems
        .where('exercise_id')
        .equals(id)
        .filter((item) => item.deleted_at === null)
        .count()
      if (used > 0) throw new ExerciseInUseError('Exercise is used by a plan')
      const existing = await this.db.exercises.get(id)
      if (!existing || existing.deleted_at !== null) return
      const ts = now()
      await this.db.exercises.put({ ...existing, deleted_at: ts, updated_at: ts })
    })
  }

  async updateProfile(patch: { units?: Units; weight_increment?: number }): Promise<Profile> {
    if (patch.weight_increment !== undefined && !(patch.weight_increment > 0)) {
      throw new Error('weight_increment must be greater than 0')
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
        await d.exercises.toCollection().modify((e) => {
          e.default_weight = conv(e.default_weight)
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
          r.success_amount =
            r.success_amount === current.weight_increment
              ? newIncrement
              : Math.max(newIncrement, roundToIncrement(conv(r.success_amount), newIncrement))
          r.updated_at = ts
        })
      }
      if (patch.weight_increment !== undefined) next.weight_increment = patch.weight_increment
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

  async getPlan(id: string): Promise<PlanTree | undefined> {
    const plan = await this.db.plans.get(id)
    if (!plan || plan.deleted_at !== null) return undefined
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
        const rule = (await this.db.rules.get(item.id)) ?? null
        full.push({ ...item, exercise, rule, effective: effectiveValues(item, exercise) })
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

  async savePlanDay(input: { id?: string; plan_id: string; name: string }): Promise<PlanDay> {
    return this.db.transaction('rw', this.db.profile, this.db.planDays, async () => {
      const existing = input.id ? await this.db.planDays.get(input.id) : undefined
      const ts = now()
      let day: PlanDay
      if (existing) {
        day = planDaySchema.parse({ ...existing, name: input.name, updated_at: ts })
      } else {
        const siblings = (await this.db.planDays.where('plan_id').equals(input.plan_id).toArray()).filter(
          (d) => d.deleted_at === null,
        )
        day = planDaySchema.parse({
          id: input.id ?? newId(),
          plan_id: input.plan_id,
          name: input.name,
          position: nextPosition(siblings),
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
      if (item.deleted_at === null) await this.db.planItems.put({ ...item, deleted_at: ts, updated_at: ts })
    }
  }

  async addPlanItem(planDayId: string, exerciseId: string): Promise<PlanItem> {
    const { profile, planItems, rules, itemStates } = this.db
    return this.db.transaction('rw', profile, planItems, rules, itemStates, async () => {
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
        created_at: ts,
        updated_at: ts,
        deleted_at: null,
      })
      const increment = (await this.getProfile()).weight_increment
      const base = { plan_item_id: item.id, created_at: ts, updated_at: ts, deleted_at: null }
      await planItems.add(item)
      await rules.add(progressionRuleSchema.parse({ ...defaultRule(increment), ...base }))
      await itemStates.add(itemStateSchema.parse({ ...base, fail_streak: 0 }))
      return item
    })
  }

  async updatePlanItem(
    id: string,
    patch: { sets?: number | null; reps?: number | null; weight?: number | null },
  ): Promise<PlanItem> {
    return this.db.transaction('rw', this.db.planItems, this.db.itemStates, async () => {
      const existing = await this.db.planItems.get(id)
      if (!existing || existing.deleted_at !== null) throw new Error('Plan item not found')
      const ts = now()
      const next = { ...existing, updated_at: ts }
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
    const item = await this.db.planItems.get(id)
    if (!item || item.deleted_at !== null) return
    const ts = now()
    await this.db.planItems.put({ ...item, deleted_at: ts, updated_at: ts })
  }

  async setRule(planItemId: string, rule: RuleInput | null): Promise<void> {
    const parsed = rule === null ? null : ruleInputSchema.parse(rule)
    await this.db.transaction('rw', this.db.rules, async () => {
      if (parsed === null) {
        await this.db.rules.delete(planItemId)
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
    const logs = (await this.db.setLogs.where('session_id').equals(session.id).toArray()).sort(
      (a, b) => a.position - b.position || a.set_no - b.set_no,
    )
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
        const logs: SetLog[] = []
        for (const item of items) {
          const exercise = await exercises.get(item.exercise_id)
          if (!exercise) continue
          const eff = effectiveValues(item, exercise)
          for (let set_no = 1; set_no <= eff.sets; set_no++) {
            logs.push(
              setLogSchema.parse({
                id: newId(),
                session_id: session.id,
                plan_item_id: item.id,
                exercise_id: exercise.id,
                exercise_name: exercise.name,
                set_no,
                position: item.position,
                target_reps: eff.targetReps,
                target_weight: eff.targetWeight,
                actual_reps: eff.targetReps,
                weight: eff.targetWeight,
                done: false,
                note: '',
                created_at: ts,
                updated_at: ts,
                deleted_at: null,
              }),
            )
          }
        }
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
        const increment = (await this.getProfile()).weight_increment
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
          const rule = (await rules.get(item.id)) ?? null
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
}
