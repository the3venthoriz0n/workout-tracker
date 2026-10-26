import { Pencil, Trash2 } from 'lucide-react'
import { useEffect, useRef, type Ref } from 'react'
import { Button } from '@/components/ui/button'

// Standard pencil + trash pair for a Library row.
export function RowActions({
  name,
  onEdit,
  onDelete,
  trashRef,
}: {
  name: string
  onEdit: () => void
  onDelete: () => void
  trashRef?: Ref<HTMLButtonElement>
}) {
  return (
    <div className="flex items-center gap-0.5">
      <Button
        type="button"
        variant="ghost"
        className="text-muted-foreground hover:text-foreground size-11 p-0"
        aria-label={`Edit ${name}`}
        onClick={onEdit}
      >
        <Pencil className="size-5" aria-hidden />
      </Button>
      <Button
        ref={trashRef}
        type="button"
        variant="ghost"
        className="text-muted-foreground hover:text-destructive size-11 p-0"
        aria-label={`Delete ${name}`}
        onClick={onDelete}
      >
        <Trash2 className="size-5" aria-hidden />
      </Button>
    </div>
  )
}

const COPY = {
  exercise: {
    checking: 'Checking where this is used…',
    error: "Couldn't check where this exercise is used. It may be in your plans.",
  },
  gear: {
    checking: 'Checking which exercises need this gear…',
    error: "Couldn't check which exercises need this gear. Some may depend on it.",
  },
} as const

// Inline two-step confirmation shown inside the row (no second overlay). Fails closed:
// Delete stays disabled until `status` is 'ready'. Focus starts on Cancel (safe default).
export function DeleteConfirm({
  name,
  subject,
  status,
  impact,
  pending,
  onRetry,
  onConfirm,
  onCancel,
}: {
  name: string
  subject: 'exercise' | 'gear'
  status: 'checking' | 'error' | 'ready'
  impact: string
  pending: boolean
  onRetry?: () => void
  onConfirm: () => void
  onCancel: () => void
}) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => cancelRef.current?.focus(), [])
  return (
    <div role="group" aria-label={`Confirm delete ${name}`} className="bg-background mt-1 mb-2 mr-2.5 flex flex-col gap-2 rounded-row p-3">
      <p className="text-sm font-medium">Delete {name}?</p>
      {status === 'checking' && (
        <p className="text-muted-foreground text-sm">{COPY[subject].checking}</p>
      )}
      {status === 'error' && (
        <p role="alert" className="text-destructive text-sm">
          {COPY[subject].error}
        </p>
      )}
      {status === 'ready' && <p className="text-muted-foreground text-sm">{impact}</p>}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="destructive"
          className="min-h-11 flex-1"
          disabled={pending || status !== 'ready'}
          onClick={onConfirm}
        >
          Delete
        </Button>
        {status === 'error' && onRetry && (
          <Button type="button" variant="outline" className="min-h-11 flex-1" onClick={() => {
              cancelRef.current?.focus()
              onRetry()
            }}
          >
            Retry
          </Button>
        )}
        <Button
          ref={cancelRef}
          type="button"
          variant="outline"
          className="min-h-11 flex-1"
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}

// Moves focus back to the row's trash button once the confirm closes without deleting.
export function useRestoreFocus(confirming: boolean) {
  const trashRef = useRef<HTMLButtonElement>(null)
  const was = useRef(false)
  useEffect(() => {
    if (was.current && !confirming) trashRef.current?.focus()
    was.current = confirming
  }, [confirming])
  return trashRef
}

// After a confirmed delete the row is gone: park focus on the list panel, not <body>.
export const focusLibraryPanel = () => document.getElementById('library-panel')?.focus()
