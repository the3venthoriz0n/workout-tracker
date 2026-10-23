import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { NumberField } from '@/components/number-field'
import { RuleEditor } from '@/components/rule-editor'
import { Button } from '@/components/ui/button'
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
        <div className="border-t pt-3">
          <RuleEditor
            rule={rule}
            itemName={name}
            idPrefix={`rule-${item.id}`}
            onSave={(next) => setRule.mutateAsync({ planItemId: item.id, rule: next })}
          />
        </div>
      )}
    </li>
  )
}
