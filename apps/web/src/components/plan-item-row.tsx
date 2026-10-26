import { ANGLES, type Angle } from '@workout/shared'
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react'
import { useId, useState } from 'react'
import { NumberField } from '@/components/number-field'
import { ANGLE_NAMES, AngleChip, SupersetLabel } from '@/components/plan-bits'
import { RuleEditor } from '@/components/rule-editor'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { formatWeight } from '@/lib/format'
import { notifyError } from '@/lib/notify'
import { summarizeRule } from '@/lib/rule-summary'
import { segmentedItem, segmentedTrack } from '@/lib/styles'
import { cn } from '@/lib/utils'
import {
  useClearRule,
  useDeletePlanItem,
  useMove,
  useProfile,
  useSetRule,
  useUpdatePlanItem,
} from '@/repo/hooks'
import type { PlanTree } from '@/repo/types'

type Item = PlanTree['days'][number]['items'][number]

// supersetLabel: "A1", "A2", ... when the item is in a superset
type Props = { item: Item; isFirst?: boolean; isLast?: boolean; supersetLabel?: string }

export function PlanItemRow({ item, isFirst = false, isLast = false, supersetLabel }: Props) {
  const profile = useProfile().data
  const units = profile?.units ?? 'lb'
  const update = useUpdatePlanItem()
  const move = useMove()
  const remove = useDeletePlanItem()
  const setRule = useSetRule()
  const clearRule = useClearRule()
  const amrapHelpId = useId()
  const [expanded, setExpanded] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const { exercise, effective: eff, rule, ruleSource } = item
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

  // Angle and AMRAP never clear targets
  function setOption(p: { angle?: Angle | null; amrap_last?: boolean }) {
    update.mutate({ id: item.id, patch: p }, { onError: (e) => fail(e) })
  }

  return (
    <li aria-label={name} className="flex flex-col gap-3 py-4">
      <div className="flex items-start gap-2">
        {supersetLabel && <SupersetLabel label={supersetLabel} className="mt-0.5" />}
        <div className="min-w-0 flex-1">
          <p className="text-[17px] font-semibold">
            {name}
            <AngleChip angle={item.angle} />
          </p>
          <p className="text-muted-foreground text-sm tabular-nums">
            Next: {eff.sets}×{eff.targetReps}
            {item.amrap_last && '+'} @ {formatWeight(eff.targetWeight)} {units}
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

      {exercise.supports_angle && (
        <div role="group" aria-label={`Angle for ${name}`} className={segmentedTrack}>
          {ANGLES.map((a) => {
            const on = item.angle === a
            return (
              <button
                key={a}
                type="button"
                aria-pressed={on}
                className={segmentedItem(on)}
                // Tapping the selected angle again unsets it (angle is optional)
                onClick={() => setOption({ angle: on ? null : a })}
              >
                {ANGLE_NAMES[a]}
              </button>
            )
          })}
        </div>
      )}

      <div className="flex flex-col">
        <label className="flex min-h-11 items-center justify-between gap-3 text-sm font-medium">
          Last set is AMRAP
          <Switch
            checked={item.amrap_last}
            aria-label="Last set is AMRAP"
            aria-describedby={amrapHelpId}
            onCheckedChange={(on) => setOption({ amrap_last: on })}
          />
        </label>
        <p id={amrapHelpId} className="text-muted-foreground -mt-1 text-sm">
          Target reps is the minimum. Log what you actually did.
        </p>
      </div>

      <div className="flex items-start gap-2 text-sm">
        <Badge variant={ruleSource === 'item' ? 'default' : 'outline'} className="mt-0.5">
          {ruleSource === 'item' ? 'Override' : 'Default'}
        </Badge>
        <span className="text-muted-foreground min-w-0 tabular-nums">{summarizeRule(rule, units)}</span>
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
            className="text-destructive hover:text-destructive min-h-11"
            aria-label={`Delete ${name}`}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 aria-hidden /> Delete
          </Button>
        )}
      </div>

      {expanded && (
        <div className="border-border-strong/70 border-t pt-3">
          <RuleEditor
            rule={rule}
            source={ruleSource}
            itemName={name}
            idPrefix={`rule-${item.id}`}
            onSave={(next) => setRule.mutateAsync({ planItemId: item.id, rule: next })}
            onClear={() => clearRule.mutateAsync(item.id)}
          />
        </div>
      )}
    </li>
  )
}
