import type { Angle, DayColor } from '@workout/shared'
import { dayColorVar } from '@/lib/day-colors'
import { cn } from '@/lib/utils'

export const ANGLE_NAMES: Record<Angle, string> = { flat: 'Flat', incline: 'Incline', decline: 'Decline' }

/** "Bench Press · Incline" (plain text, for summaries). */
export const nameWithAngle = (name: string, angle: Angle | null | undefined) =>
  angle ? `${name} · ${ANGLE_NAMES[angle]}` : name

/** Decorative colour bar for a plan day; the day name is always shown next to it. */
export function DayBar({ color, className }: { color: DayColor | null | undefined; className?: string }) {
  if (!color) return null
  return (
    <span
      aria-hidden
      data-day-color={color}
      className={cn('block w-1.5 shrink-0 self-stretch rounded-full', className)}
      style={{ background: dayColorVar(color) }}
    />
  )
}

/** Small chip after an exercise name; reads as "Bench Press · Incline" to screen readers. */
export function AngleChip({ angle }: { angle: Angle | null | undefined }) {
  if (!angle) return null
  return (
    <>
      <span className="sr-only"> · </span>
      <span
        data-slot="angle-chip"
        className="bg-secondary text-secondary-foreground ml-2 inline-flex items-center rounded-sm px-1.5 py-0.5 align-middle font-sans text-xs font-semibold tracking-wide uppercase"
      >
        {ANGLE_NAMES[angle]}
      </span>
    </>
  )
}

/** Superset member label (A1, A2, ...). */
export function SupersetLabel({ label, className }: { label: string; className?: string }) {
  return (
    <span
      className={cn(
        'font-heading border-foreground/70 inline-flex h-6 min-w-8 shrink-0 items-center justify-center rounded-sm border px-1 text-sm leading-none font-bold tabular-nums',
        className,
      )}
    >
      {label}
    </span>
  )
}
