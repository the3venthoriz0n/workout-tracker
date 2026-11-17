import { ANGLES, exerciseUnit, type Angle } from '@workout/shared'
import { ChevronDown, ChevronRight, ChevronUp, Trash2 } from 'lucide-react'
import { useId, useState, type CSSProperties } from 'react'
import { Disclosure } from '@/components/disclosure'
import { NumberField } from '@/components/number-field'
import { ANGLE_NAMES, AngleChip, SupersetLabel } from '@/components/plan-bits'
import { RuleEditor } from '@/components/rule-editor'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { formatWeight } from '@/lib/format'
import { notifyError } from '@/lib/notify'
import { summarizeRule } from '@/lib/rule-summary'
import { useWeightText } from '@/lib/weight-text'
import type { useDragReorder } from '@/lib/use-drag-reorder'
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
/** Wiring for long-press drag reordering (see useDragReorder); absent for rows that cannot be dragged. */
export type RowDrag = {
  rowRef: (el: HTMLElement | null) => void
  style?: CSSProperties
  className?: string
  handle: ReturnType<ReturnType<typeof useDragReorder>['handle']>
}
type Props = { item: Item; isFirst?: boolean; isLast?: boolean; supersetLabel?: string; drag?: RowDrag }

export function PlanItemRow({ item, isFirst = false, isLast = false, supersetLabel, drag }: Props) {
  const profile = useProfile().data
  const units = exerciseUnit(item.exercise, profile?.units ?? 'lb')
  const weightText = useWeightText()
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
    <li ref={drag?.rowRef} style={drag?.style} aria-label={name} className={cn('flex flex-col gap-3 py-3', drag?.className)}>
      {/* Collapsed: the name and its next target. Everything else opens from here. */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={`${name} details`}
          className={cn('rounded-row flex min-h-14 min-w-0 flex-1 items-center gap-2 text-left', drag && 'select-none')}
          {...drag?.handle}
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
              {item.amrap_last && '+'} @ {weightText(eff.targetWeight, units)}
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
        <div className="flex flex-wrap items-center justify-center gap-2 text-center">
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

          {/* The rule: where it comes from and what it does; opened, its editor sits inside the same dropdown */}
          <Disclosure
            id={ruleId}
            title="Progression"
            label={`Progression for ${name}`}
            summary={
              <>
                <span>{ruleSource === 'item' ? 'Override' : 'Default'}</span> · <span>{summarizeRule(rule, units)}</span>
              </>
            }
            open={ruleOpen}
            onToggle={() => setRuleOpen((e) => !e)}
            fieldBg="var(--card)"
          >
            <RuleEditor
              rule={rule}
              source={ruleSource}
              itemName={name}
              unit={units}
              idPrefix={`rule-${item.id}`}
              onSave={(next) => setRule.mutateAsync({ planItemId: item.id, rule: next })}
              onClear={() => clearRule.mutateAsync(item.id)}
            />
          </Disclosure>
        </div>
      )}
    </li>
  )
}
