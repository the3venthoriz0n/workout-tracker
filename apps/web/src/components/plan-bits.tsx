import type { Angle, DayColor } from '@workout/shared'
import { dayColorVar } from '@/lib/day-colors'
import { cn } from '@/lib/utils'

export const ANGLE_NAMES: Record<Angle, string> = { flat: 'Flat', incline: 'Incline', decline: 'Decline' }

/** "Bench Press · Incline" (plain text, for summaries). */
export const nameWithAngle = (name: string, angle: Angle | null | undefined) =>
  angle ? `${name} · ${ANGLE_NAMES[angle]}` : name

/** Decorative colour dot for a plan day; the day name is always shown next to it. */
export function DayDot({ color, className }: { color: DayColor | null | undefined; className?: string }) {
  if (!color) return null
  return (
    <span
      aria-hidden
      data-day-color={color}
      className={cn('block size-2.5 shrink-0 rounded-full', className)}
      style={{ background: dayColorVar(color) }}
    />
  )
}

/** Small pill after an exercise name; reads as "Bench Press · Incline" to screen readers. */
export function AngleChip({ angle }: { angle: Angle | null | undefined }) {
  if (!angle) return null
  return (
    <>
      <span className="sr-only"> · </span>
      <span
        data-slot="angle-chip"
        className="bg-secondary text-secondary-foreground ml-2 inline-flex h-6 items-center rounded-full px-2.5 align-middle font-sans text-xs font-medium tracking-normal"
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
        'bg-brand/12 text-foreground inline-flex h-6 min-w-9 shrink-0 items-center justify-center rounded-full px-2 text-[13px] leading-none font-semibold tabular-nums',
        className,
      )}
    >
      {label}
    </span>
  )
}

/** Thin accent rail on the left edge of a grouped surface (supersets, overrides). */
export function Rail() {
  return <span aria-hidden className="bg-brand absolute top-6 bottom-6 left-0 w-[3px] rounded-r-full" />
}
