import { cn } from '@/lib/utils'

// A list on one soft surface with hairline dividers (plans, library, history, progression).
export const listGroup = 'surface rounded-card divide-y divide-border-strong/70 overflow-hidden'

// Pill segmented control (angle, units, library sections, account action).
export const segmentedTrack = 'bg-muted flex gap-1 rounded-full p-1'
export const segmentedItem = (on: boolean) =>
  cn(
    'min-h-11 flex-1 rounded-full px-4 text-[15px] font-medium',
    on ? 'bg-primary text-primary-foreground font-semibold' : 'text-muted-foreground hover:text-foreground',
  )

// Inline confirmation inside a surface (card) or on the page.
export const confirmBox = 'bg-background flex flex-col gap-3 rounded-row p-4'
export const confirmPanel = 'surface flex flex-col gap-3 rounded-card p-4'
