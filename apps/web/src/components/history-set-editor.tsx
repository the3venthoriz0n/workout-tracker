import type { SetLog } from '@workout/shared'
import { CheckIcon } from 'lucide-react'
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
    <div className="bg-background mt-2 mb-2 flex flex-col gap-3 rounded-row p-3 [--field:var(--card)]">
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
          'flex min-h-11 items-center justify-between gap-2 rounded-field px-3.5 text-left text-sm font-medium',
          set.done ? 'bg-brand text-brand-foreground' : 'bg-field text-foreground',
        )}
        onClick={() => void onSave({ done: !set.done })}
      >
        Counted as done
        <CheckIcon aria-hidden strokeWidth={2.5} className={cn('size-5', set.done ? 'opacity-100' : 'opacity-0')} />
      </button>
      <Input
        aria-label={`Note for set ${set.set_no}`}
        placeholder="Note"
        enterKeyHint="done"
        autoComplete="off"
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
