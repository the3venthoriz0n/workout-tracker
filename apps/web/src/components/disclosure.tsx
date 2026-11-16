import { ChevronRight } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * A dropdown row: a title with a one-line summary and a chevron. Opened, the contents stay inside the
 * same rounded container under the header, so the two read as one thing. Fields inside take the sheet's
 * background (not the container's), so they still stand out. Same row as the plan page's Progression.
 */
export function Disclosure({
  id,
  title,
  summary,
  label,
  open,
  onToggle,
  fieldBg = 'var(--popover)',
  children,
}: {
  id: string
  title: string
  summary: ReactNode
  /** Accessible name when it should differ from the visible text (the summary is not part of it). */
  label?: string
  open: boolean
  onToggle: () => void
  /** The surface behind the Disclosure: fields inside it take this colour. */
  fieldBg?: string
  children: ReactNode
}) {
  return (
    <div className="bg-(--field) rounded-row">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={label}
        className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left"
        onClick={onToggle}
      >
        <span className="min-w-0 flex-1 text-sm">
          <span className="block font-medium">{title}</span>
          <span className="text-muted-foreground block tabular-nums">{summary}</span>
        </span>
        <ChevronRight aria-hidden className={cn('text-muted-foreground size-5 shrink-0', open && 'rotate-90')} />
      </button>
      {open && (
        <div id={id} className="flex flex-col gap-4 px-4 pt-1 pb-4" style={{ '--field': fieldBg } as CSSProperties}>
          {children}
        </div>
      )}
    </div>
  )
}
