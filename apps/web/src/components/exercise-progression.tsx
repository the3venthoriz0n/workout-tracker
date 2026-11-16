import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { Rail } from '@/components/plan-bits'
import { RuleFields } from '@/components/rule-editor'
import { Button } from '@/components/ui/button'
import { SkeletonRows } from '@/components/ui/skeleton'
import { notifyError } from '@/lib/notify'
import { SOURCE_NAMES, summarizeRule } from '@/lib/rule-summary'
import { cn } from '@/lib/utils'
import { useClearRule, useProfile, useProgressionByExercise, useSetExerciseRule } from '@/repo/hooks'

const itemsInherit = (n: number) =>
  n === 0 ? 'No items inherit' : n === 1 ? '1 item inherits' : `${n} items inherit`

/**
 * An exercise's progression rule, inside its editor: where the rule comes from, the rule itself,
 * and the plan items that override it. Changes save as you make them (they do not wait for Save).
 * A plan item uses its own override, else the exercise's rule, else the app default (Library, Progression).
 */
export function ExerciseProgression({ exerciseId, name }: { exerciseId: string; name: string }) {
  const units = useProfile().data?.units ?? 'lb'
  const { data: rows, isPending } = useProgressionByExercise()
  const setExerciseRule = useSetExerciseRule()
  const clearRule = useClearRule()
  const [open, setOpen] = useState(false)
  const row = rows?.find((r) => r.exercise_id === exerciseId)

  if (isPending || !row) return <SkeletonRows rows={1} />
  const used = row.inheriting.length + row.overrides.length

  return (
    <section aria-label={`Progression for ${name}`} className="flex flex-col gap-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="ex-progression"
        className="bg-(--field) rounded-row flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="min-w-0 flex-1 text-sm">
          <span className="block font-medium">Progression</span>
          <span className="text-muted-foreground block tabular-nums">
            <span>{SOURCE_NAMES[row.source]}</span> · <span>{summarizeRule(row.rule, units)}</span>
          </span>
        </span>
        <ChevronRight aria-hidden className={cn('text-muted-foreground size-5 shrink-0', open && 'rotate-90')} />
      </button>

      {open && (
        <div id="ex-progression" className="flex flex-col gap-3">
          <p className="text-muted-foreground text-sm">
            {row.source === 'exercise'
              ? `Default for every ${name} item without its own override.`
              : `Uses the ${row.source === 'profile' ? 'app' : 'built-in'} default. Changing a value gives ${name} its own default.`}{' '}
            {used === 0 ? 'Not in any plan.' : `${itemsInherit(row.inheriting.length)}.`} Saves as you change it.
          </p>
          <RuleFields
            rule={row.rule}
            idPrefix={`ex-rule-${row.exercise_id}`}
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
        </div>
      )}
    </section>
  )
}
