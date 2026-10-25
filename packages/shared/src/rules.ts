// Rule layering (spec §6): item override ?? exercise.default_rule ?? profile.default_rule ?? built-in.
import { defaultRule } from './progression.js'
import type { RuleInput, RuleSource } from './schemas.js'

export type InheritedSource = Exclude<RuleSource, 'item'>

/** The rule an item without an override gets: exercise default, then profile default, then built-in. */
export function inheritedRule(
  exerciseRule: RuleInput | null,
  profileRule: RuleInput | undefined,
  increment: number,
): { rule: RuleInput; source: InheritedSource } {
  if (exerciseRule) return { rule: exerciseRule, source: 'exercise' }
  if (profileRule) return { rule: profileRule, source: 'profile' }
  return { rule: defaultRule(increment), source: 'builtin' }
}

/**
 * The effective rule of a plan item. A stored item rule always wins. Without one, `inherit`
 * (plan_item.inherit_rule) decides: true inherits, false is an explicit "no progression" override.
 */
export function resolveRule(input: {
  itemRule: RuleInput | null | undefined
  inherit: boolean
  exerciseRule: RuleInput | null
  profileRule: RuleInput | undefined
  increment: number
}): { rule: RuleInput | null; source: RuleSource } {
  if (input.itemRule) return { rule: input.itemRule, source: 'item' }
  if (!input.inherit) return { rule: null, source: 'item' }
  return inheritedRule(input.exerciseRule, input.profileRule, input.increment)
}

/** Picks only the rule fields (drops plan_item_id and sync columns from a stored row). */
export function ruleFieldsOf(r: RuleInput): RuleInput {
  return {
    success_action: r.success_action,
    success_amount: r.success_amount,
    fail_streak_limit: r.fail_streak_limit,
    deload_pct: r.deload_pct,
    rep_ceiling: r.rep_ceiling,
  }
}

export type ItemPlacement = { plan_id: string; plan_name: string; day_id: string; day_name: string; item_id: string }
export type ExerciseProgression = {
  exercise_id: string
  exercise_name: string
  /** The exercise's effective default (what inheriting items use). */
  rule: RuleInput
  source: InheritedSource
  /** Items with their own rule; `rule: null` is a "no progression" override. */
  overrides: (ItemPlacement & { rule: RuleInput | null })[]
  inheriting: ItemPlacement[]
}

type Row = ItemPlacement & { exercise_id: string; rule: RuleInput | null; ruleSource: RuleSource }

/** Groups the per-item progression list by exercise; every exercise given appears once, in the given order. */
export function groupProgressionByExercise(
  exercises: { id: string; name: string; default_rule: RuleInput | null }[],
  rows: Row[],
  profile: { default_rule?: RuleInput | undefined; weight_increment: number },
): ExerciseProgression[] {
  return exercises.map((e) => {
    const mine = rows.filter((r) => r.exercise_id === e.id)
    const place = (r: Row): ItemPlacement => ({
      plan_id: r.plan_id,
      plan_name: r.plan_name,
      day_id: r.day_id,
      day_name: r.day_name,
      item_id: r.item_id,
    })
    return {
      exercise_id: e.id,
      exercise_name: e.name,
      ...inheritedRule(e.default_rule, profile.default_rule, profile.weight_increment),
      overrides: mine.filter((r) => r.ruleSource === 'item').map((r) => ({ ...place(r), rule: r.rule })),
      inheriting: mine.filter((r) => r.ruleSource !== 'item').map(place),
    }
  })
}
