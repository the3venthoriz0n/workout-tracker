import { NUTRIENTS, NUTRITION_LIMITS, nutritionSettingsOf, nutritionSettingsSchema } from '@workout/shared'
import type { NutrientKey, NutritionSettings } from '@workout/shared'
import { useRef } from 'react'
import { LoadError } from '@/components/load-error'
import { NumberField } from '@/components/number-field'
import { SkeletonRows } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { notifyError } from '@/lib/notify'
import { listGroup } from '@/lib/styles'
import { useProfile, useUpdateProfile } from '@/repo/hooks'

/**
 * Which nutrients to track, and an optional daily goal for each. A switch per nutrient, with its goal
 * field under it while it is on. Turning one off only hides it: entries keep what they stored. At
 * least one nutrient stays on, so the last switch is disabled and says why.
 */
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
  function setGoal(key: NutrientKey, value: number | null): boolean {
    if (value !== null && (value <= 0 || value > NUTRITION_LIMITS[key])) return false
    const goals = { ...settings.goals }
    if (value === null) delete goals[key]
    else goals[key] = value
    save({ ...settings, goals })
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
                  <NumberField
                    label={`${n.label} goal (${n.unit})`}
                    kind="weight"
                    allowEmpty
                    value={settings.goals[n.key] ?? null}
                    placeholder="No goal"
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
