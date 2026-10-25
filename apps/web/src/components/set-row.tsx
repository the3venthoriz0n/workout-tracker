import type { SetLog } from '@workout/shared'
import { CheckIcon, PencilIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { NumberField } from '@/components/number-field'
import { Input } from '@/components/ui/input'
import { formatWeight } from '@/lib/format'
import { tapHaptic } from '@/lib/haptics'
import { cn } from '@/lib/utils'

type Patch = { done?: boolean; actual_reps?: number; weight?: number; note?: string }
type Props = {
  set: SetLog
  unit: string
  onToggle: () => Promise<boolean>
  onEdit: (patch: Patch) => Promise<boolean>
}

const LONG_PRESS_MS = 500
const MOVE_TOLERANCE_PX = 10

export function SetRow({ set, unit, onToggle, onEdit }: Props) {
  const [editing, setEditing] = useState(false)
  const [note, setNote] = useState(set.note)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressed = useRef(false)
  const origin = useRef({ x: 0, y: 0 })
  const pending = useRef(false)

  const cancelPress = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(() => cancelPress, [])

  function commitNote() {
    const next = note.trim()
    if (next !== set.note) void onEdit({ note: next })
  }

  return (
    <li className="flex flex-col">
      <div className="flex items-stretch gap-2">
        <button
          type="button"
          aria-pressed={set.done}
          aria-label={`Set ${set.set_no}: ${set.actual_reps} × ${formatWeight(set.weight)} ${unit}`}
          className={cn(
            'flex min-h-16 w-full min-w-0 flex-1 touch-manipulation items-center gap-3 rounded-md border-2 px-3 text-left select-none',
            set.done
              ? 'border-primary bg-primary text-primary-foreground'
              : 'bg-card text-card-foreground border-border',
          )}
          onPointerDown={(e) => {
            origin.current = { x: e.clientX, y: e.clientY }
            longPressed.current = false
            cancelPress()
            timer.current = setTimeout(() => {
              longPressed.current = true
              setEditing(true)
            }, LONG_PRESS_MS)
          }}
          onPointerUp={cancelPress}
          onPointerMove={(e) => {
            if (
              Math.hypot(e.clientX - origin.current.x, e.clientY - origin.current.y) >
              MOVE_TOLERANCE_PX
            )
              cancelPress()
          }}
          onPointerCancel={cancelPress}
          onPointerLeave={cancelPress}
          onContextMenu={(e) => e.preventDefault()}
          onClick={() => {
            if (longPressed.current) {
              longPressed.current = false
              return
            }
            if (pending.current) return
            pending.current = true
            if (!set.done) tapHaptic()
            void onToggle().finally(() => {
              pending.current = false
            })
          }}
        >
          {/* Set number as a small plate; inverted when done */}
          <span
            aria-hidden
            className={cn(
              'font-heading flex size-9 shrink-0 items-center justify-center rounded-full border-2 text-lg font-bold tabular-nums',
              set.done
                ? 'border-primary-foreground bg-primary-foreground text-primary'
                : 'border-foreground/70 text-foreground',
            )}
          >
            {set.set_no}
          </span>
          <span aria-hidden className="font-heading min-w-0 flex-1 truncate text-[24px] leading-none font-bold tabular-nums">
            {`${set.actual_reps} × ${formatWeight(set.weight)} ${unit}`}
          </span>
          <CheckIcon
            aria-hidden
            strokeWidth={3}
            className={cn('size-7 shrink-0', set.done ? 'text-primary-foreground' : 'text-muted-foreground/40')}
          />
        </button>
        <button
          type="button"
          aria-label={`Edit set ${set.set_no}`}
          aria-expanded={editing}
          className="text-muted-foreground hover:bg-accent flex min-h-11 min-w-12 items-center justify-center rounded-md"
          onClick={() => setEditing((v) => !v)}
        >
          <PencilIcon className="size-4" />
        </button>
      </div>
      {editing && (
        <div className="bg-card mt-2 mb-1 flex flex-col gap-3 rounded-md border p-3">
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label="Reps"
              kind="reps"
              value={set.actual_reps}
              onCommit={(v) => {
                if (v === null || v < 0) return false
                return onEdit({ actual_reps: v })
              }}
            />
            <NumberField
              label="Weight"
              kind="weight"
              suffix={unit}
              value={set.weight}
              onCommit={(v) => {
                if (v === null || v < 0) return false
                return onEdit({ weight: v })
              }}
            />
          </div>
          <Input
            aria-label={`Note for set ${set.set_no}`}
            className="min-h-11"
            placeholder="Note"
            enterKeyHint="done"
            autoComplete="off"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={commitNote}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
          />
        </div>
      )}
    </li>
  )
}
