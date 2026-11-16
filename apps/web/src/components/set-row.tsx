import type { SetLog } from '@workout/shared'
import { CheckIcon, MinusIcon, PencilIcon, PlusIcon } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { NumberField } from '@/components/number-field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatWeight } from '@/lib/format'
import { tapHaptic } from '@/lib/haptics'
import { cn } from '@/lib/utils'

type Patch = { done?: boolean; actual_reps?: number; weight?: number; note?: string }
type Props = {
  set: SetLog
  unit: string
  /** The profile's progression step: how far the weight - and + buttons move. */
  step?: number
  onToggle: () => Promise<boolean>
  onEdit: (patch: Patch) => Promise<boolean>
  /** In a superset block: the member's label (A1) and exercise name, shown on the row. */
  member?: { label: string; name: string }
  /** Later sets of this exercise, not done, whose weight differs from this set's. */
  restCount?: number
  /** Copies this set's weight onto those later sets. */
  onApplyToRest?: () => Promise<boolean>
  /** Called when the editor opens, so the page can stop showing the first-use hint. */
  onEditOpen?: () => void
}

const LONG_PRESS_MS = 500
const MOVE_TOLERANCE_PX = 10

export function SetRow({ set, unit, step = 5, onToggle, onEdit, member, restCount = 0, onApplyToRest, onEditOpen }: Props) {
  const [editing, setEditing] = useState(false)
  const [focusReps, setFocusReps] = useState(false)
  const [note, setNote] = useState(set.note)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressed = useRef(false)
  const origin = useRef({ x: 0, y: 0 })
  const pending = useRef(false)
  const moved = useRef(false)
  const repsId = `set-reps-${set.id}`

  const cancelPress = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(() => cancelPress, [])
  useEffect(() => {
    if (editing) onEditOpen?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])
  useEffect(() => {
    if (!editing || !focusReps) return
    const el = document.getElementById(repsId) as HTMLInputElement | null
    el?.focus()
    el?.select()
    setFocusReps(false)
  }, [editing, focusReps, repsId])

  // An AMRAP set's reps are the minimum until logged: "5+" while untouched
  const reps = set.amrap && !set.done && set.actual_reps === set.target_reps ? `${set.actual_reps}+` : String(set.actual_reps)
  const numbers = `${reps} × ${formatWeight(set.weight)} ${unit}`
  const label = `Set ${set.set_no}: ${numbers}${set.amrap ? ', AMRAP' : ''}${member ? `, ${member.label} ${member.name}` : ''}`

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
          aria-label={label}
          className={cn(
            // Soft block; done is a solid accent fill plus the check (never colour alone)
            'flex min-h-[68px] w-full min-w-0 flex-1 touch-manipulation items-center gap-3 rounded-row px-3.5 text-left select-none',
            set.done
              ? 'bg-brand text-brand-foreground'
              : 'bg-(--row) text-foreground hover:bg-[color-mix(in_oklch,var(--row),var(--foreground)_5%)]',
          )}
          onPointerDown={(e) => {
            origin.current = { x: e.clientX, y: e.clientY }
            longPressed.current = false
            moved.current = false
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
            ) {
              moved.current = true
              cancelPress()
            }
          }}
          onPointerCancel={cancelPress}
          onPointerLeave={cancelPress}
          onContextMenu={(e) => e.preventDefault()}
          onClick={() => {
            if (longPressed.current) {
              longPressed.current = false
              return
            }
            // A drag that started on the row is a scroll, not a tap
            if (moved.current) {
              moved.current = false
              return
            }
            if (pending.current) return
            pending.current = true
            const markingDone = !set.done
            if (markingDone) tapHaptic()
            void onToggle()
              .then((ok) => {
                // The AMRAP rep count is the number most likely to change: open it right after
                // the set is saved as done (the toggle itself never waits on the editor)
                if (ok && markingDone && set.amrap) {
                  setEditing(true)
                  setFocusReps(true)
                }
              })
              .finally(() => {
                pending.current = false
              })
          }}
        >
          {/* Set number in a small circle; inverted when done */}
          <span
            aria-hidden
            className={cn(
              'flex size-9 shrink-0 items-center justify-center rounded-full text-[15px] font-semibold tabular-nums',
              set.done ? 'bg-brand-foreground text-brand' : 'bg-foreground/8 text-foreground',
            )}
          >
            {set.set_no}
          </span>
          <span aria-hidden className="flex min-w-0 flex-1 flex-col gap-1.5">
            {(member || set.amrap) && (
              <span className="flex min-w-0 items-center gap-2">
                {member && (
                  <span
                    className={cn(
                      'truncate text-sm leading-none font-medium',
                      set.done ? 'text-brand-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {member.label} · {member.name}
                  </span>
                )}
                {set.amrap && (
                  <span
                    className={cn(
                      'inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[11px] leading-none font-semibold',
                      set.done ? 'ring-brand-foreground text-brand-foreground ring-1 ring-inset' : 'bg-foreground/8 text-foreground',
                    )}
                  >
                    AMRAP
                  </span>
                )}
              </span>
            )}
            <span className="truncate text-[26px] leading-none max-[374px]:text-[22px] font-semibold tracking-[-0.02em] tabular-nums">{numbers}</span>
          </span>
          {set.done && <CheckIcon aria-hidden strokeWidth={3} className="text-brand-foreground size-6 shrink-0" />}
        </button>
        <button
          type="button"
          aria-label={`Edit set ${set.set_no}`}
          aria-expanded={editing}
          className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-11 shrink-0 items-center justify-center self-center rounded-full aria-expanded:bg-accent aria-expanded:text-foreground"
          onClick={() => setEditing((v) => !v)}
        >
          <PencilIcon className="size-4" />
        </button>
      </div>
      {editing && (
        <div className="surface rounded-row mt-2 mb-1 flex flex-col gap-3 p-3.5">
          {/* Each number sits between the two buttons that nudge it, so a thumb never leaves the field it is editing */}
          <div className="flex items-end gap-2">
            <StepButton
              label="Less reps"
              onClick={() => set.actual_reps > 0 && void onEdit({ actual_reps: set.actual_reps - 1 })}
            >
              <MinusIcon className="size-5" aria-hidden />
            </StepButton>
            <NumberField
              className="min-w-0 flex-1"
              label="Reps"
              id={repsId}
              kind="reps"
              value={set.actual_reps}
              onCommit={(v) => {
                if (v === null || v < 0) return false
                return onEdit({ actual_reps: v })
              }}
            />
            <StepButton label="More reps" onClick={() => void onEdit({ actual_reps: set.actual_reps + 1 })}>
              <PlusIcon className="size-5" aria-hidden />
            </StepButton>
          </div>
          <div className="flex items-end gap-2">
            <StepButton
              label={`Less weight by ${formatWeight(step)}`}
              onClick={() => set.weight - step >= 0 && void onEdit({ weight: Number((set.weight - step).toFixed(2)) })}
            >
              −{formatWeight(step)}
            </StepButton>
            <NumberField
              className="min-w-0 flex-1"
              label="Weight"
              kind="weight"
              suffix={unit}
              value={set.weight}
              onCommit={(v) => {
                if (v === null || v < 0) return false
                return onEdit({ weight: v })
              }}
            />
            <StepButton
              label={`More weight by ${formatWeight(step)}`}
              onClick={() => void onEdit({ weight: Number((set.weight + step).toFixed(2)) })}
            >
              +{formatWeight(step)}
            </StepButton>
          </div>
          {restCount > 0 && onApplyToRest && (
            <Button variant="secondary" className="min-h-11" onClick={() => void onApplyToRest()}>
              Use {formatWeight(set.weight)} {unit} for the other {restCount} {restCount === 1 ? 'set' : 'sets'}
            </Button>
          )}
          <Input
            aria-label={`Note for set ${set.set_no}`}
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

// A 48px round nudge button (the commonest correction: one more rep, or one progression step more)
function StepButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      className="bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_6%)] flex size-12 shrink-0 items-center justify-center rounded-full text-sm font-medium tabular-nums"
      onClick={onClick}
    >
      {children}
    </button>
  )
}
