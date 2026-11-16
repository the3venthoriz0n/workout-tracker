import { NUTRIENTS, NUTRITION_LIMITS, nutritionSettingsOf, nutritionSettingsSchema } from '@workout/shared'
import type { NutrientKey, NutritionSettings } from '@workout/shared'
import { NumberField } from '@/components/number-field'
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
  const profile = useProfile().data
  const update = useUpdateProfile()
  if (!profile) return null
  const settings = nutritionSettingsOf(profile)
  const onlyOne = settings.tracked.length === 1

  // Always sent through the schema: canonical order, nothing unknown
  const save = (next: NutritionSettings) =>
    update.mutate({ nutrition: nutritionSettingsSchema.parse(next) }, { onError: (err) => notifyError(err, "Couldn't save your goals") })

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
