import { useState } from 'react'
import type { Units } from '@workout/shared'
import { Disclosure } from '@/components/disclosure'
import { Rail } from '@/components/plan-bits'
import { RuleFields } from '@/components/rule-editor'
import { Button } from '@/components/ui/button'
import { SkeletonRows } from '@/components/ui/skeleton'
import { notifyError } from '@/lib/notify'
import { SOURCE_NAMES, summarizeRule } from '@/lib/rule-summary'
import { useClearRule, useProgressionByExercise, useSetExerciseRule } from '@/repo/hooks'

/**
 * An exercise's progression rule, inside its editor: where the rule comes from, the rule itself,
 * and the plan items that override it. Changes save as you make them (they do not wait for Save).
 * A plan item uses its own override, else the exercise's rule, else the app default (Library, Progression).
 */
export function ExerciseProgression({ exerciseId, name, unit }: { exerciseId: string; name: string; unit: Units }) {
  const units = unit
  const { data: rows, isPending } = useProgressionByExercise()
  const setExerciseRule = useSetExerciseRule()
  const clearRule = useClearRule()
  const [open, setOpen] = useState(false)
  const row = rows?.find((r) => r.exercise_id === exerciseId)

  if (isPending || !row) return <SkeletonRows rows={1} />

  return (
    <section aria-label={`Progression for ${name}`}>
      <Disclosure
        id="ex-progression"
        title="Progression override"
        summary={
          <>
            <span>{SOURCE_NAMES[row.source]}</span> · <span>{summarizeRule(row.rule, units)}</span>
          </>
        }
        open={open}
        onToggle={() => setOpen((o) => !o)}
      >
      <p className="text-muted-foreground text-sm">
        {row.source === 'exercise'
          ? `Default for every ${name} item without its own override.`
          : `Uses the ${row.source === 'profile' ? 'app' : 'built-in'} default. Changing a value gives ${name} its own default.`}
      </p>
      <RuleFields
        rule={row.rule}
        idPrefix={`ex-rule-${row.exercise_id}`}
        unit={unit}
        showStepHint={false}
        onSave={(next) => setExerciseRule.mutateAsync({ exerciseId: row.exercise_id, rule: next })}
      />
      {row.source === 'exercise' && (
        <Button
          type="button"
          variant="outline"
          className="min-h-11 self-start"
          disabled={setExerciseRule.isPending}
          aria-label={`Use app default for ${name}`}
          onClick={() =>
            setExerciseRule.mutate(
              { exerciseId: row.exercise_id, rule: null },
              { onError: (err) => notifyError(err) },
            )
          }
        >
          Use app default
        </Button>
      )}

      {row.overrides.length > 0 && (
        <ul
          aria-label={`Overrides of ${name}`}
          className="bg-background relative flex flex-col rounded-row py-1 pr-2 pl-4 [--field:var(--card)]"
        >
          <Rail />
          {row.overrides.map((o) => {
            const where = `${o.plan_name} · ${o.day_name}`
            return (
              <li key={o.item_id} aria-label={where} className="flex items-center gap-2">
                <div className="min-w-0 flex-1 py-1">
                  <p className="text-sm font-medium">{where}</p>
                  <p className="text-muted-foreground text-sm tabular-nums">{summarizeRule(o.rule, units)}</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-11"
                  disabled={clearRule.isPending}
                  aria-label={`Use default for ${name} in ${where}`}
                  onClick={() => clearRule.mutate(o.item_id, { onError: (err) => notifyError(err) })}
                >
                  Use default
                </Button>
              </li>
            )
          })}
        </ul>
      )}
      </Disclosure>
    </section>
  )
}
