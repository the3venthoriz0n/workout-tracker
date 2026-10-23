import type { SetLog } from '@workout/shared'
import { useEffect, useState } from 'react'
import { NumberField } from '@/components/number-field'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type Patch = { done?: boolean; actual_reps?: number; weight?: number; note?: string }

// Inline editor for one set of a finished workout; every change saves immediately.
export function HistorySetEditor({
  set,
  unit,
  onSave,
}: {
  set: SetLog
  unit: string
  onSave: (patch: Patch) => Promise<boolean>
}) {
  const [note, setNote] = useState(set.note)
  const repsId = `reps-${set.id}`
  useEffect(() => {
    document.getElementById(repsId)?.focus()
  }, [repsId])
  return (
    <div className="mt-2 mb-1 flex flex-col gap-3 rounded-md border p-3">
      <div className="grid grid-cols-2 gap-3">
        <NumberField
          label="Reps"
          id={repsId}
          kind="reps"
          value={set.actual_reps}
          onCommit={(v) => {
            if (v === null || v < 0) return false
            return onSave({ actual_reps: v })
          }}
        />
        <NumberField
          label="Weight"
          kind="weight"
          suffix={unit}
          value={set.weight}
          onCommit={(v) => {
            if (v === null || v < 0) return false
            return onSave({ weight: v })
          }}
        />
      </div>
      <button
        type="button"
        aria-pressed={set.done}
        className={cn(
          'min-h-11 rounded-md border px-3 text-left text-sm',
          set.done ? 'border-primary bg-primary/10' : 'bg-card',
        )}
        onClick={() => void onSave({ done: !set.done })}
      >
        Counted as done
      </button>
      <Input
        aria-label={`Note for set ${set.set_no}`}
        className="min-h-11"
        placeholder="Note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => {
          const next = note.trim()
          setNote(next)
          if (next !== set.note) {
            void onSave({ note: next }).then((ok) => {
              if (!ok) setNote(set.note)
            })
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
      />
    </div>
  )
}
