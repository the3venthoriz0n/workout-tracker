import { defaultRule, type RuleInput } from '@workout/shared'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Screen } from '@/app/screen'
import { NumberField } from '@/components/number-field'
import { RuleEditor, RuleFields } from '@/components/rule-editor'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatWeight, pluralize } from '@/lib/format'
import { notifyError } from '@/lib/notify'
import { useProfile, useProgression, useSetRule, useUpdateProfile } from '@/repo/hooks'
import type { ProgressionRow } from '@/repo/types'

function summarize(rule: RuleInput | null, units: string): string {
  if (!rule) return 'No progression'
  const gain =
    rule.success_action === 'add_weight'
      ? `+${formatWeight(rule.success_amount)} ${units} on success`
      : `Adds ${pluralize(rule.success_amount, 'rep')}`
  const ceiling = rule.rep_ceiling !== null ? ` · up to ${pluralize(rule.rep_ceiling, 'rep')}` : ''
  return `${gain}${ceiling} · deload ${rule.deload_pct}% after ${pluralize(rule.fail_streak_limit, 'miss', 'misses')}`
}

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
        <CardTitle>Defaults for new plan items</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-muted-foreground text-sm">
          Changing these only affects plan items you add afterwards.
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

function RuleRow({ row, units }: { row: ProgressionRow; units: string }) {
  const [expanded, setExpanded] = useState(false)
  const setRule = useSetRule()
  const Icon = expanded ? ChevronUp : ChevronDown
  return (
    <li aria-label={row.exercise_name} className="flex flex-col gap-2 py-2">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{row.exercise_name}</p>
          <p className="text-muted-foreground text-sm tabular-nums">{summarize(row.rule, units)}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="min-h-11 min-w-11"
          aria-expanded={expanded}
          aria-label={`Edit rule for ${row.exercise_name}`}
          onClick={() => setExpanded((e) => !e)}
        >
          <Icon aria-hidden />
        </Button>
      </div>
      {expanded && (
        <div className="border-t pt-3">
          <RuleEditor
            rule={row.rule}
            itemName={row.exercise_name}
            idPrefix={`prog-${row.item_id}`}
            onSave={(next) => setRule.mutateAsync({ planItemId: row.item_id, rule: next })}
          />
        </div>
      )}
    </li>
  )
}

function ItemRulesCard() {
  const units = useProfile().data?.units ?? 'lb'
  const rows = useProgression().data
  if (!rows) return null

  // Rows arrive ordered plan -> day -> item, so group by consecutive ids
  const plans: { id: string; name: string; days: { id: string; name: string; rows: ProgressionRow[] }[] }[] = []
  for (const r of rows) {
    let plan = plans.at(-1)
    if (plan?.id !== r.plan_id) {
      plan = { id: r.plan_id, name: r.plan_name, days: [] }
      plans.push(plan)
    }
    let day = plan.days.at(-1)
    if (day?.id !== r.day_id) {
      day = { id: r.day_id, name: r.day_name, rows: [] }
      plan.days.push(day)
    }
    day.rows.push(r)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Plan item rules</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {plans.length === 0 ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-muted-foreground text-sm">No plans yet</p>
            <Button asChild variant="outline" className="min-h-11">
              <Link to="/plans">Go to Plans</Link>
            </Button>
          </div>
        ) : (
          plans.map((plan) => (
            <section key={plan.id} aria-label={plan.name} className="flex flex-col gap-3">
              <h2 className="font-heading text-lg leading-tight font-bold">{plan.name}</h2>
              {plan.days.map((day) => (
                <div key={day.id} className="flex flex-col gap-2">
                  <h3 className="text-muted-foreground text-sm font-medium">{day.name}</h3>
                  <ul className="divide-y border-y">
                    {day.rows.map((r) => (
                      <RuleRow key={r.item_id} row={r} units={units} />
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          ))
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
        <ItemRulesCard />
      </div>
    </div>
  )
}
