import { NUTRIENTS, NUTRITION_LIMITS, nutritionSettingsOf, nutritionSettingsSchema } from '@workout/shared'
import type { NutrientKey, NutritionSettings } from '@workout/shared'
import { useId, useRef, useState } from 'react'
import { LoadError } from '@/components/load-error'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SkeletonRows } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { parseGoal, showGoal } from '@/lib/nutrition-goal-text'
import type { GoalValue } from '@/lib/nutrition-goal-text'
import { notifyError } from '@/lib/notify'
import { listGroup } from '@/lib/styles'
import { useProfile, useUpdateProfile } from '@/repo/hooks'

/**
 * Which nutrients to track, and an optional daily goal for each. A switch per nutrient, with its goal
 * field under it while it is on. Turning one off only hides it: entries keep what they stored. At
 * least one nutrient stays on, so the last switch is disabled and says why.
 */
// Leaves goalMins off entirely when empty, so settings without a range stay as they were
function withMins(settings: NutritionSettings, goalMins: NonNullable<NutritionSettings['goalMins']>): NutritionSettings {
  const { goalMins: _old, ...rest } = settings
  return Object.keys(goalMins).length === 0 ? rest : { ...rest, goalMins }
}

export function NutritionGoals() {
  const query = useProfile()
  const update = useUpdateProfile()
  // The latest choice while saves are in flight, so quick successive changes build on each other
  // instead of on a cached profile that has not caught up yet (and so the screen answers at once)
  const pending = useRef<NutritionSettings | null>(null)
  const inFlight = useRef(0)
  if (query.isError) return <LoadError what="your goals" onRetry={() => void query.refetch()} />
  if (!query.data) return <SkeletonRows rows={3} />
  const settings = pending.current ?? nutritionSettingsOf(query.data)
  const onlyOne = settings.tracked.length === 1

  // Always sent through the schema: canonical order, nothing unknown
  function save(next: NutritionSettings) {
    const parsed = nutritionSettingsSchema.parse(next)
    pending.current = parsed
    inFlight.current++
    update.mutate(
      { nutrition: parsed },
      {
        onError: (err) => notifyError(err, "Couldn't save your goals"),
        onSettled: () => {
          if (--inFlight.current === 0) pending.current = null
        },
      },
    )
  }

  function setTracked(key: NutrientKey, on: boolean) {
    save({ ...settings, tracked: on ? [...settings.tracked, key] : settings.tracked.filter((k) => k !== key) })
  }

  // false (the field reverts) for a goal of zero, negative or beyond what one day can hold
  function setGoal(key: NutrientKey, value: GoalValue | null): boolean {
    if (value !== null && (value.max <= 0 || value.max > NUTRITION_LIMITS[key])) return false
    const goals = { ...settings.goals }
    const goalMins = { ...settings.goalMins }
    if (value === null) {
      delete goals[key]
      delete goalMins[key]
    } else {
      goals[key] = value.max
      if (value.min === null) delete goalMins[key]
      else goalMins[key] = value.min
    }
    save(withMins({ ...settings, goals }, goalMins))
    return true
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className={listGroup}>
        {NUTRIENTS.map((n) => {
          const on = settings.tracked.includes(n.key)
          return (
            <li key={n.key} className="flex flex-col gap-3 px-4 py-2">
              <label className="flex min-h-11 items-center justify-between gap-3">
                <span className="text-[17px] font-semibold">{n.label}</span>
                <Switch
                  checked={on}
                  disabled={on && onlyOne}
                  aria-label={`Track ${n.label}`}
                  onCheckedChange={(next) => setTracked(n.key, next)}
                />
              </label>
              {on && (
                <div className="pb-2">
                  <GoalField
                    label={`${n.label} goal (${n.unit})`}
                    unit={n.unit}
                    value={settings.goals[n.key] === undefined ? null : { min: settings.goalMins?.[n.key] ?? null, max: settings.goals[n.key]! }}
                    onCommit={(v) => setGoal(n.key, v)}
                  />
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {onlyOne && <p className="text-muted-foreground text-sm">Keep at least one nutrient on.</p>}
    </div>
  )
}

/** One text field for a goal: "190", or a range such as "170-190". Commits on blur or Enter; text that is not a goal reverts. */
function GoalField({ label, unit, value, onCommit }: { label: string; unit: string; value: GoalValue | null; onCommit: (v: GoalValue | null) => boolean }) {
  const id = useId()
  const shown = showGoal(value)
  const [text, setText] = useState(shown)
  const [seen, setSeen] = useState(shown)
  const [focused, setFocused] = useState(false)
  // Follow the saved goal, but never while the person is typing
  if (seen !== shown) {
    setSeen(shown)
    if (!focused) setText(shown)
  }
  function commit() {
    setFocused(false)
    const parsed = parseGoal(text, unit)
    if (parsed === undefined || !onCommit(parsed)) setText(shown)
    else setText(showGoal(parsed))
  }
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        className="tabular-nums"
        enterKeyHint="done"
        autoComplete="off"
        autoCapitalize="none"
        placeholder="No goal. Try 190 or 170-190"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            e.currentTarget.blur()
          }
        }}
      />
    </div>
  )
}
