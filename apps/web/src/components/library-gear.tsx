import { useState } from 'react'
import { toast } from 'sonner'
import { DeleteConfirm, RowActions } from '@/components/row-actions'
import { Switch } from '@/components/ui/switch'
import { pluralize } from '@/lib/format'
import { notifyError } from '@/lib/notify'
import { useDeleteGear, useExercises, useGear, useSaveGear } from '@/repo/hooks'
import type { Gear } from '@workout/shared'

export function LibraryGear({ onEdit }: { onEdit: (gear: Gear) => void }) {
  const gear = useGear().data ?? []
  const exercises = useExercises().data ?? []

  const counts = new Map<string, number>()
  const needing = new Map<string, number>()
  for (const ex of exercises) {
    for (const id of ex.required_gear_ids) {
      needing.set(id, (needing.get(id) ?? 0) + 1)
      if (ex.active) counts.set(id, (counts.get(id) ?? 0) + 1)
    }
  }

  return (
    <div className="flex flex-col gap-3 px-4 pb-4">
      <p className="text-muted-foreground text-sm">
        Gear you own decides which exercises appear when you build a plan.
      </p>
      <ul className="flex flex-col gap-2">
        {gear.map((g) => (
          <GearRow
            key={g.id}
            gear={g}
            activeCount={counts.get(g.id) ?? 0}
            needCount={needing.get(g.id) ?? 0}
            onEdit={() => onEdit(g)}
          />
        ))}
      </ul>
    </div>
  )
}

function GearRow({
  gear: g,
  activeCount,
  needCount,
  onEdit,
}: {
  gear: Gear
  activeCount: number
  needCount: number
  onEdit: () => void
}) {
  const saveGear = useSaveGear()
  const remove = useDeleteGear()
  const [confirming, setConfirming] = useState(false)

  const impact =
    needCount > 0
      ? `${pluralize(needCount, 'exercise')} need this gear. They stay in your library but will no longer require it.`
      : "This can't be undone."

  return (
    <li className="bg-card flex flex-col rounded-lg border px-3 py-1">
      <div className="flex items-center gap-1">
        <label className="flex min-h-11 flex-1 items-center justify-between gap-3 text-sm">
          <span className="flex flex-col">
            {g.name}
            <span className="text-muted-foreground text-xs">
              {pluralize(activeCount, 'exercise')}
            </span>
          </span>
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
          <RowActions name={g.name} onEdit={onEdit} onDelete={() => setConfirming(true)} />
        )}
      </div>
      {confirming && (
        <DeleteConfirm
          name={g.name}
          impact={impact}
          pending={remove.isPending}
          onCancel={() => setConfirming(false)}
          onConfirm={() =>
            remove.mutate(g.id, {
              onSuccess: () => toast.success('Gear deleted'),
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
