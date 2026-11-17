import { NUTRIENTS } from '@workout/shared'
import type { NutrientKey, NutritionEntry } from '@workout/shared'
import { useState } from 'react'
import { NutritionEntrySheet } from '@/components/nutrition-entry-sheet'
import { DeleteConfirm, RowActions, tileClick, useRestoreFocus } from '@/components/row-actions'
import { notifyError } from '@/lib/notify'
import { listGroup } from '@/lib/styles'
import { useDeleteNutritionEntry } from '@/repo/hooks'

/** "680 kcal · 32 g protein"; a nutrient this entry has no value for is a dash. */
function summary(entry: NutritionEntry, tracked: NutrientKey[]): string {
  return NUTRIENTS.filter((n) => tracked.includes(n.key))
    .map((n) => {
      const v = entry[n.key]
      if (v === null) return `– ${n.label.toLowerCase()}`
      return n.unit === 'kcal' ? `${v} kcal` : `${v} ${n.unit} ${n.label.toLowerCase()}`
    })
    .join(' · ')
}

export function NutritionLog({ entries, tracked, aiOn = true }: { entries: readonly NutritionEntry[]; tracked: NutrientKey[]; aiOn?: boolean }) {
  if (entries.length === 0) {
    return <p className="text-muted-foreground text-sm">{aiOn ? 'Nothing logged yet. Say what you ate above.' : 'Nothing logged yet. Add what you ate above.'}</p>
  }
  return (
    <ul className={listGroup}>
      {entries.map((e) => (
        <EntryRow key={e.id} entry={e} tracked={tracked} />
      ))}
    </ul>
  )
}

// One logged food: tapping it (or the pencil) edits it, the trash deletes after a confirm.
function EntryRow({ entry, tracked }: { entry: NutritionEntry; tracked: NutrientKey[] }) {
  const remove = useDeleteNutritionEntry()
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const trashRef = useRestoreFocus(confirming)
  const onEdit = () => setEditing(true)

  return (
    <>
      <li className="flex cursor-pointer flex-col py-1.5 pr-1.5 pl-4" onClick={tileClick(onEdit, confirming)}>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="flex min-h-12 min-w-0 flex-1 flex-col items-start justify-center gap-0.5 py-1 text-left"
            onClick={onEdit}
          >
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-[17px] font-semibold break-words">{entry.name}</span>
              {entry.source === 'ai' && (
                <span className="bg-secondary text-foreground inline-flex h-6 items-center rounded-full px-2.5 text-sm font-medium">estimate</span>
              )}
            </span>
            {entry.quantity !== '' && <span className="text-muted-foreground text-sm">{entry.quantity}</span>}
            <span className="text-muted-foreground text-sm tabular-nums">{summary(entry, tracked)}</span>
          </button>
          {!confirming && <RowActions trashRef={trashRef} name={entry.name} onEdit={onEdit} onDelete={() => setConfirming(true)} />}
        </div>
        {confirming && (
          <DeleteConfirm
            name={entry.name}
            subject="entry"
            status="ready"
            impact="This can't be undone."
            pending={remove.isPending}
            onCancel={() => setConfirming(false)}
            onConfirm={() => remove.mutate(entry.id, { onError: (err) => notifyError(err, "Couldn't delete the entry") })}
          />
        )}
      </li>
      {/* Outside the <li>: a click inside the sheet would otherwise bubble up through React to the tile */}
      <NutritionEntrySheet entry={entry} tracked={tracked} open={editing} onOpenChange={setEditing} />
    </>
  )
}
