import { Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

// Standard pencil + trash pair for a Library row.
export function RowActions({
  name,
  onEdit,
  onDelete,
}: {
  name: string
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className="flex items-center">
      <Button
        type="button"
        variant="ghost"
        className="size-11 p-0"
        aria-label={`Edit ${name}`}
        onClick={onEdit}
      >
        <Pencil className="size-5" aria-hidden />
      </Button>
      <Button
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

// Inline two-step confirmation shown inside the row (no second overlay).
export function DeleteConfirm({
  name,
  impact,
  pending,
  onConfirm,
  onCancel,
}: {
  name: string
  impact: string
  pending: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div role="group" aria-label={`Confirm delete ${name}`} className="flex flex-col gap-2 p-2">
      <p className="text-sm font-medium">Delete {name}?</p>
      <p className="text-muted-foreground text-sm">{impact}</p>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="destructive"
          className="min-h-11 flex-1"
          disabled={pending}
          onClick={onConfirm}
        >
          Delete
        </Button>
        <Button type="button" variant="outline" className="min-h-11 flex-1" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
