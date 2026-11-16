import { ANGLES, type Angle } from '@workout/shared'
import { ChevronDown, ChevronRight, ChevronUp, Trash2 } from 'lucide-react'
import { useId, useState } from 'react'
import { NumberField } from '@/components/number-field'
import { ANGLE_NAMES, AngleChip, SupersetLabel } from '@/components/plan-bits'
import { RuleEditor } from '@/components/rule-editor'
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
  const [open, setOpen] = useState(false)
  const [ruleOpen, setRuleOpen] = useState(false)
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

  const bodyId = `item-body-${item.id}`
  const ruleId = `item-rule-${item.id}`

  return (
    <li aria-label={name} className="flex flex-col gap-3 py-3">
      {/* Collapsed: the name and its next target. Everything else opens from here. */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={`${name} details`}
          className="rounded-row flex min-h-14 min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => setOpen((o) => !o)}
        >
          <ChevronRight
            aria-hidden
            className={cn('text-muted-foreground size-5 shrink-0', open && 'rotate-90')}
          />
          <span className="min-w-0 flex-1">
            <span className="block text-[17px] font-semibold">
              {/* In a superset the A1/A2 chip rides on the name line so the row is as wide as any other */}
              {supersetLabel && <SupersetLabel label={supersetLabel} className="mr-2 h-5 min-w-7 px-1.5 align-[2px]" />}
              {name}
              <AngleChip angle={item.angle} />
            </span>
            <span className="text-muted-foreground block text-sm tabular-nums">
              Next: {eff.sets}×{eff.targetReps}
              {item.amrap_last && '+'} @ {formatWeight(eff.targetWeight)} {units}
            </span>
          </span>
        </button>
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
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-destructive focus-visible:text-destructive min-h-11 min-w-11"
          aria-label={`Delete ${name}`}
          aria-expanded={confirmDelete}
          onClick={() => setConfirmDelete(true)}
        >
          <Trash2 className="size-5" aria-hidden />
        </Button>
      </div>

      {confirmDelete && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-muted-foreground w-full text-sm">Removes {name} from this day. Past workouts keep their records.</p>
          <Button
            variant="destructive"
            className="min-h-11"
            aria-label={`Confirm delete ${name}`}
            disabled={remove.isPending}
            onClick={() => remove.mutate(item.id, { onError: (e) => fail(e) })}
          >
            Confirm delete
          </Button>
          <Button variant="ghost" className="min-h-11" autoFocus onClick={() => setConfirmDelete(false)}>
            Cancel
          </Button>
        </div>
      )}

      {open && (
        <div id={bodyId} className="flex flex-col gap-3">
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

          {/* One row for the rule: where it comes from, what it does, and the way into its editor */}
          <button
            type="button"
            aria-expanded={ruleOpen}
            aria-controls={ruleId}
            aria-label={`Progression for ${name}`}
            className="bg-(--field) rounded-row flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left"
            onClick={() => setRuleOpen((e) => !e)}
          >
            <span className="min-w-0 flex-1 text-sm">
              <span className="block font-medium">Progression</span>
              <span className="text-muted-foreground block tabular-nums">
                <span>{ruleSource === 'item' ? 'Override' : 'Default'}</span> · <span>{summarizeRule(rule, units)}</span>
              </span>
            </span>
            <ChevronRight aria-hidden className={cn('text-muted-foreground size-5 shrink-0', ruleOpen && 'rotate-90')} />
          </button>

          {ruleOpen && (
            <div id={ruleId}>
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
        </div>
      )}
    </li>
  )
}
