import type { RuleInput, RuleSource } from '@workout/shared'
import { formatWeight, pluralize } from '@/lib/format'

/** One line: "+5 lb on success · deload 10% after 3 misses". */
export function summarizeRule(rule: RuleInput | null, units: string): string {
  if (!rule) return 'No progression'
  const gain =
    rule.success_action === 'add_weight'
      ? `+${formatWeight(rule.success_amount)} ${units} on success`
      : `Adds ${pluralize(rule.success_amount, 'rep')}`
  const ceiling = rule.rep_ceiling !== null ? ` · up to ${pluralize(rule.rep_ceiling, 'rep')}` : ''
  return `${gain}${ceiling} · deload ${rule.deload_pct}% after ${pluralize(rule.fail_streak_limit, 'miss', 'misses')}`
}

/** Badge text for where an inherited rule comes from (spec §6 rule layering). */
export const SOURCE_NAMES: Record<Exclude<RuleSource, 'item'>, string> = {
  exercise: 'Exercise default',
  profile: 'App default',
  builtin: 'Built-in',
}

/** Lower-case phrase for helper text: "the exercise default". */
export const SOURCE_PHRASES: Record<Exclude<RuleSource, 'item'>, string> = {
  exercise: 'the exercise default',
  profile: 'the app default',
  builtin: 'the built-in default',
}
