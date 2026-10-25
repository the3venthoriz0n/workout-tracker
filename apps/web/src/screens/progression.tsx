import { defaultRule, type ExerciseProgression } from '@workout/shared'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Screen } from '@/app/screen'
import { NumberField } from '@/components/number-field'
import { RuleFields } from '@/components/rule-editor'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SkeletonRows } from '@/components/ui/skeleton'
import { notifyError } from '@/lib/notify'
import { SOURCE_NAMES, summarizeRule } from '@/lib/rule-summary'
import {
  useClearRule,
  useProfile,
  useProgressionByExercise,
  useSetExerciseRule,
  useUpdateProfile,
} from '@/repo/hooks'

function StepCard() {
  const profile = useProfile().data
  const updateProfile = useUpdateProfile()
  const [error, setError] = useState<string | null>(null)
  if (!profile) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>Progression step</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        <NumberField
          label="Progression step"
          kind="weight"
          suffix={profile.units}
          value={profile.weight_increment}
          onCommit={(v) => {
            if (v === null || v <= 0) {
              setError('Progression step must be greater than 0.')
              return false
            }
            setError(null)
            updateProfile.mutate({ weight_increment: v }, { onError: (err) => notifyError(err) })
          }}
        />
        <p className="text-muted-foreground text-sm">
          The smallest weight change you can load. Progress steps and deloads snap to it.
        </p>
        {error && <p className="text-destructive text-sm">{error}</p>}
      </CardContent>
    </Card>
  )
}

function DefaultsCard() {
  const profile = useProfile().data
  const updateProfile = useUpdateProfile()
  if (!profile) return null
  const rule = profile.default_rule ?? defaultRule(profile.weight_increment)
  return (
    <Card>
      <CardHeader>
        <CardTitle>App default rule</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-muted-foreground text-sm">
          Used by every exercise without its own default. Changing it updates every plan item that
          inherits it, now and from the next workout on.
        </p>
        <RuleFields
          rule={rule}
          idPrefix="default-rule"
          showStepHint={false}
          onSave={async (next) => {
            await updateProfile.mutateAsync({ default_rule: next })
          }}
        />
      </CardContent>
    </Card>
  )
}

const itemsInherit = (n: number) =>
  n === 0 ? 'No items inherit' : n === 1 ? '1 item inherits' : `${n} items inherit`

function ExerciseRow({ row, units }: { row: ExerciseProgression; units: string }) {
  const [expanded, setExpanded] = useState(false)
  const setExerciseRule = useSetExerciseRule()
  const clearRule = useClearRule()
  const Icon = expanded ? ChevronUp : ChevronDown
  const name = row.exercise_name
  const used = row.inheriting.length + row.overrides.length
  return (
    <li aria-label={name} className="flex flex-col gap-2 py-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{name}</p>
          <p className="text-muted-foreground text-sm tabular-nums">{summarizeRule(row.rule, units)}</p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            <Badge variant={row.source === 'exercise' ? 'default' : 'outline'}>{SOURCE_NAMES[row.source]}</Badge>
            <span className="text-muted-foreground">
              {used === 0 ? 'Not in any plan' : itemsInherit(row.inheriting.length)}
            </span>
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="min-h-11 min-w-11"
          aria-expanded={expanded}
          aria-label={`Edit default for ${name}`}
          onClick={() => setExpanded((e) => !e)}
        >
          <Icon aria-hidden />
        </Button>
      </div>

      {expanded && (
        <div className="flex flex-col gap-3 border-t pt-3">
          <p className="text-muted-foreground text-sm">
            {row.source === 'exercise'
              ? `Default for every ${name} item without its own override.`
              : `Uses the ${row.source === 'profile' ? 'app' : 'built-in'} default. Changing a value gives ${name} its own default.`}
          </p>
          <RuleFields
            rule={row.rule}
            idPrefix={`ex-rule-${row.exercise_id}`}
            showStepHint={false}
            onSave={(next) => setExerciseRule.mutateAsync({ exerciseId: row.exercise_id, rule: next })}
          />
          {row.source === 'exercise' && (
            <Button
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
        </div>
      )}

      {row.overrides.length > 0 && (
        <ul aria-label={`Overrides of ${name}`} className="border-muted-foreground ml-1 flex flex-col border-l-2 pl-3">
          {row.overrides.map((o) => {
            const where = `${o.plan_name} · ${o.day_name}`
            return (
              <li key={o.item_id} aria-label={where} className="flex items-center gap-2">
                <div className="min-w-0 flex-1 py-1">
                  <p className="text-sm font-medium">{where}</p>
                  <p className="text-muted-foreground text-sm tabular-nums">{summarizeRule(o.rule, units)}</p>
                </div>
                <Button
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
    </li>
  )
}

function ExerciseRulesCard() {
  const units = useProfile().data?.units ?? 'lb'
  const { data: rows, isPending } = useProgressionByExercise()
  return (
    <Card>
      <CardHeader>
        <CardTitle>Exercise rules</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-muted-foreground text-sm">
          A plan item uses its own override, else its exercise's default, else the app default.
          Override a single item from its plan.
        </p>
        {isPending || !rows ? (
          <SkeletonRows rows={3} />
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-muted-foreground text-sm">No exercises yet</p>
            <Button asChild variant="outline" className="min-h-11">
              <Link to="/library">Go to Library</Link>
            </Button>
          </div>
        ) : (
          <ul className="divide-y border-y">
            {rows.map((r) => (
              <ExerciseRow key={r.exercise_id} row={r} units={units} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

export function ProgressionScreen() {
  return (
    <div>
      <Screen title="Progression" />
      <div className="flex flex-col gap-4 px-4 pb-4">
        <StepCard />
        <DefaultsCard />
        <ExerciseRulesCard />
      </div>
    </div>
  )
}
