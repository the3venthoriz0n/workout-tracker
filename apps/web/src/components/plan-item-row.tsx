import { defaultRule, ruleInputSchema, type RuleInput } from '@workout/shared'
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { NumberField } from '@/components/number-field'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { formatWeight } from '@/lib/format'
import { notifyError } from '@/lib/notify'
import {
  useDeletePlanItem,
  useMove,
  useProfile,
  useSetRule,
  useUpdatePlanItem,
} from '@/repo/hooks'
import type { PlanTree } from '@/repo/types'

type Item = PlanTree['days'][number]['items'][number]

type Props = { item: Item; isFirst?: boolean; isLast?: boolean }

export function PlanItemRow({ item, isFirst = false, isLast = false }: Props) {
  const profile = useProfile().data
  const units = profile?.units ?? 'lb'
  const increment = profile?.weight_increment ?? 5
  const update = useUpdatePlanItem()
  const move = useMove()
  const remove = useDeletePlanItem()
  const setRule = useSetRule()
  const [expanded, setExpanded] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const { exercise, effective: eff, rule } = item
  const name = exercise.name
  const fail = (err: unknown) => notifyError(err)

  // Resolves true on success (or no-op), false on failure so NumberField reverts its text
  async function patch(p: {
    sets?: number | null
    reps?: number | null
    weight?: number | null
  }): Promise<boolean> {
    // Re-committing the stored override must not clear progression targets
    const unchanged = (['sets', 'reps', 'weight'] as const).every(
      (k) => p[k] === undefined || p[k] === item[k],
    )
    if (unchanged) return true
    try {
      await update.mutateAsync({ id: item.id, patch: p })
      return true
    } catch (err) {
      fail(err)
      return false
    }
  }

  // Resolves false when the rule fails validation or the write fails, so NumberField reverts
  async function saveRule(next: RuleInput | null): Promise<boolean> {
    if (next !== null) {
      const parsed = ruleInputSchema.safeParse(next)
      if (!parsed.success) return false
      next = parsed.data
    }
    try {
      await setRule.mutateAsync({ planItemId: item.id, rule: next })
      return true
    } catch (err) {
      fail(err)
      return false
    }
  }

  return (
    <li aria-label={name} className="bg-card flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{name}</p>
          <p className="text-muted-foreground text-sm">
            Next: {eff.sets}×{eff.targetReps} @ {formatWeight(eff.targetWeight)} {units}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="min-h-11 min-w-11"
          aria-label={`Move ${name} up`}
          disabled={isFirst || move.isPending}
          onClick={() => move.mutate({ kind: 'item', id: item.id, direction: -1 }, { onError: (e) => fail(e) })}
        >
          <ChevronUp aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="min-h-11 min-w-11"
          aria-label={`Move ${name} down`}
          disabled={isLast || move.isPending}
          onClick={() => move.mutate({ kind: 'item', id: item.id, direction: 1 }, { onError: (e) => fail(e) })}
        >
          <ChevronDown aria-hidden />
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <NumberField
          label="Sets"
          kind="reps"
          allowEmpty
          value={item.sets}
          placeholder={String(exercise.default_sets)}
          onCommit={(v) => (v !== null && v < 1 ? false : patch({ sets: v }))}
        />
        <NumberField
          label="Reps"
          kind="reps"
          allowEmpty
          value={item.reps}
          placeholder={String(exercise.default_reps)}
          onCommit={(v) => (v !== null && v < 1 ? false : patch({ reps: v }))}
        />
        <NumberField
          label={`Weight (${units})`}
          kind="weight"
          allowEmpty
          value={item.weight}
          placeholder={formatWeight(exercise.default_weight)}
          onCommit={(v) => patch({ weight: v })}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          className="min-h-11"
          aria-expanded={expanded}
          aria-label={`Progression for ${name}`}
          onClick={() => setExpanded((e) => !e)}
        >
          Progression
        </Button>
        {confirmDelete ? (
          <>
            <Button
              variant="destructive"
              className="min-h-11"
              aria-label={`Confirm delete ${name}`}
              disabled={remove.isPending}
              onClick={() => remove.mutate(item.id, { onError: (e) => fail(e) })}
            >
              Confirm delete
            </Button>
            <Button variant="ghost" className="min-h-11" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <Button
            variant="ghost"
            className="min-h-11"
            aria-label={`Delete ${name}`}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 aria-hidden /> Delete
          </Button>
        )}
      </div>

      {expanded && (
        <div className="flex flex-col gap-3 border-t pt-3">
          <label className="flex min-h-11 items-center justify-between gap-3 text-sm font-medium">
            No progression
            <Switch
              checked={rule === null}
              aria-label={`No progression for ${name}`}
              onCheckedChange={(off) => void saveRule(off ? null : defaultRule(increment))}
            />
          </label>
          {rule && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`action-${item.id}`}>On success</Label>
                <select
                  id={`action-${item.id}`}
                  className="border-input bg-background min-h-11 rounded-md border px-3 text-sm"
                  value={rule.success_action}
                  onChange={(e) => {
                    const success_action = e.target.value as RuleInput['success_action']
                    if (success_action === rule.success_action) return
                    void saveRule({
                      ...rule,
                      success_action,
                      success_amount: success_action === 'add_reps' ? 1 : increment,
                    })
                  }}
                >
                  <option value="add_weight">Add weight</option>
                  <option value="add_reps">Add reps</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <NumberField
                  label={rule.success_action === 'add_weight' ? `Add (${units})` : 'Add (reps)'}
                  kind={rule.success_action === 'add_weight' ? 'weight' : 'reps'}
                  value={rule.success_amount}
                  onCommit={(v) =>
                    v === null || v <= 0 ? false : saveRule({ ...rule, success_amount: v })
                  }
                />
                {rule.success_action === 'add_weight' && (
                  <p className="text-muted-foreground col-span-2 -mt-1 text-xs">
                    Steps snap to your {formatWeight(increment)} {units} increment (change it in
                    Settings).
                  </p>
                )}
                <NumberField
                  label="Fail streak limit"
                  kind="reps"
                  value={rule.fail_streak_limit}
                  onCommit={(v) =>
                    v === null || v < 1 ? false : saveRule({ ...rule, fail_streak_limit: v })
                  }
                />
                <NumberField
                  label="Deload %"
                  kind="reps"
                  value={rule.deload_pct}
                  suffix="%"
                  onCommit={(v) =>
                    v === null || v < 1 || v > 100 ? false : saveRule({ ...rule, deload_pct: v })
                  }
                />
                <NumberField
                  label="Rep ceiling"
                  kind="reps"
                  allowEmpty
                  value={rule.rep_ceiling}
                  placeholder="None"
                  onCommit={(v) => saveRule({ ...rule, rep_ceiling: v })}
                />
              </div>
            </>
          )}
        </div>
      )}
    </li>
  )
}
