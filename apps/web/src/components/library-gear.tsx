import type { UseQueryResult } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { DeleteConfirm, focusLibraryPanel, RowActions, tileClick, useRestoreFocus } from '@/components/row-actions'
import { Switch } from '@/components/ui/switch'
import { pluralize } from '@/lib/format'
import { notifyError } from '@/lib/notify'
import { listGroup } from '@/lib/styles'
import { useDeleteGear, useExercises, useGear, useProfile, useSaveGear } from '@/repo/hooks'
import type { Gear } from '@workout/shared'

export function LibraryGear({ onEdit }: { onEdit: (gear: Gear) => void }) {
  const gear = useGear().data ?? []
  const exercisesQuery = useExercises()
  const exercises = exercisesQuery.data ?? []
  const units = useProfile().data?.units ?? 'lb'

  const counts = new Map<string, number>()
  const needing = new Map<string, number>()
  for (const ex of exercises) {
    for (const id of ex.required_gear_ids) {
      needing.set(id, (needing.get(id) ?? 0) + 1)
      if (ex.active) counts.set(id, (counts.get(id) ?? 0) + 1)
    }
  }

  return (
    <div className="flex flex-col gap-3 px-4 pb-6">
      <p className="text-muted-foreground text-sm">
        Gear you own decides which exercises appear when you build a plan.
      </p>
      <ul className={listGroup}>
        {gear.map((g) => (
          <GearRow
            key={g.id}
            gear={g}
            units={units}
            activeCount={exercisesQuery.isSuccess ? (counts.get(g.id) ?? 0) : null}
            needCount={exercisesQuery.isSuccess ? (needing.get(g.id) ?? 0) : null}
            exercisesQuery={exercisesQuery}
            onEdit={() => onEdit(g)}
          />
        ))}
      </ul>
    </div>
  )
}

function GearRow({
  gear: g,
  units,
  activeCount,
  needCount,
  exercisesQuery,
  onEdit,
}: {
  gear: Gear
  units: string
  activeCount: number | null
  needCount: number | null
  exercisesQuery: Pick<UseQueryResult<unknown>, 'isFetching' | 'isSuccess' | 'refetch'>
  onEdit: () => void
}) {
  const saveGear = useSaveGear()
  const remove = useDeleteGear()
  const [confirming, setConfirming] = useState(false)
  const trashRef = useRestoreFocus(confirming)

  const status: 'checking' | 'error' | 'ready' = exercisesQuery.isFetching
    ? 'checking'
    : exercisesQuery.isSuccess
      ? 'ready'
      : 'error'
  const impact =
    status === 'ready' && needCount !== null && needCount > 0
      ? `${pluralize(needCount, 'exercise')} ${needCount === 1 ? 'needs' : 'need'} this gear. ${needCount === 1 ? 'It stays' : 'They stay'} in your library but will no longer require it.`
      : "This can't be undone."

  return (
    <li className="flex cursor-pointer flex-col py-1.5 pr-1.5 pl-4" onClick={tileClick(onEdit, confirming)}>
      <div className="flex items-center gap-2">
        {/* The name opens the editor (as does the rest of the tile); the switch is its own control */}
        <button
          type="button"
          aria-label={`${g.name} details`}
          className="flex min-h-12 min-w-0 flex-1 flex-col items-start justify-center text-left text-[17px] font-semibold"
          onClick={onEdit}
        >
          {g.name}
          {(activeCount !== null || g.max_weight) && (
            <span className="text-muted-foreground text-sm font-normal">
              {[activeCount !== null ? pluralize(activeCount, 'exercise') : null, g.max_weight ? `up to ${g.max_weight} ${units}` : null]
                .filter(Boolean)
                .join(' · ')}
            </span>
          )}
        </button>
        <label className="flex min-h-11 min-w-11 items-center justify-center">
          <Switch
            checked={g.owned}
            aria-label={g.name}
            onCheckedChange={(owned) =>
              saveGear.mutate(
                { id: g.id, name: g.name, owned },
                { onError: (err) => notifyError(err) },
              )
            }
          />
        </label>
        {!confirming && (
          <RowActions trashRef={trashRef} name={g.name} onEdit={onEdit} onDelete={() => setConfirming(true)} />
        )}
      </div>
      {confirming && (
        <DeleteConfirm
          name={g.name}
          subject="gear"
          status={status}
          onRetry={() => void exercisesQuery.refetch()}
          impact={impact}
          pending={remove.isPending}
          onCancel={() => setConfirming(false)}
          onConfirm={() =>
            remove.mutate(g.id, {
              onSuccess: () => {
                toast.success('Gear deleted')
                focusLibraryPanel()
              },
              onError: (err) => {
                setConfirming(false)
                notifyError(err, "Couldn't delete that gear")
              },
            })
          }
        />
      )}
    </li>
  )
}
