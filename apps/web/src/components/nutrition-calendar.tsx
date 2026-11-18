import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import {
  hasNextMonth,
  hasPrevMonth,
  isOpenDay,
  leadingBlanks,
  longDate,
  monthDays,
  monthEnd,
  monthLabel,
  monthOf,
  monthStart,
  shiftMonth,
  weekdays,
} from '@/lib/nutrition-calendar'
import type { Month } from '@/lib/nutrition-calendar'
import { responsiveSheet } from '@/lib/sheet-classes'
import { cn } from '@/lib/utils'
import { useNutritionRange } from '@/repo/hooks'

type Props = {
  /** The day being looked at. */
  date: string
  today: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (date: string) => void
}

/**
 * A month to jump around the log: tap a day to open it. A dot marks a day with food logged (also said in
 * the day's name, never the dot alone). Only days the log accepts can be picked. It is a sheet like the
 * other editors, so it is one tap to open and one to close, and the day you were on is already selected.
 */
export function NutritionCalendar({ date, today, open, onOpenChange, onPick }: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className={responsiveSheet}
        // Opening must not pop a keyboard or jump focus into the grid: land on the sheet itself
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          ;(e.currentTarget as HTMLElement).focus({ preventScroll: true })
        }}
      >
        {open && <CalendarBody date={date} today={today} onPick={onPick} onClose={() => onOpenChange(false)} />}
      </SheetContent>
    </Sheet>
  )
}

function CalendarBody({ date, today, onPick, onClose }: { date: string; today: string; onPick: (d: string) => void; onClose: () => void }) {
  const [view, setView] = useState<Month>(() => monthOf(date))
  const days = monthDays(view)
  const logged = useNutritionRange(monthStart(view), monthEnd(view))
  const withFood = new Set((logged.data ?? []).map((e) => e.date))
  const names = weekdays()

  // Roving focus: one day is in the tab order, the arrow keys move between days
  const firstOpen = days.find((d) => isOpenDay(d, today))
  const [focusDay, setFocusDay] = useState<string | null>(null)
  const tabbable = focusDay && days.includes(focusDay) ? focusDay : days.includes(date) && isOpenDay(date, today) ? date : (firstOpen ?? null)
  const cells = useRef(new Map<string, HTMLButtonElement>())

  function onKey(e: React.KeyboardEvent, day: string) {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key]
    if (step === undefined) return
    e.preventDefault()
    const i = days.indexOf(day) + step
    const next = days[i]
    if (next && isOpenDay(next, today)) {
      setFocusDay(next)
      cells.current.get(next)?.focus()
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SheetHeader className="shrink-0 pr-14">
        <SheetTitle>Jump to a day</SheetTitle>
        <SheetDescription className="sr-only">Choose a day to see what you logged.</SheetDescription>
      </SheetHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-5 pb-5">
        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="min-h-11 min-w-11"
            aria-label="Previous month"
            disabled={!hasPrevMonth(view, today)}
            onClick={() => setView(shiftMonth(view, -1))}
          >
            <ChevronLeft aria-hidden />
          </Button>
          <h3 aria-live="polite" className="text-[17px] font-semibold">
            {monthLabel(view)}
          </h3>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="min-h-11 min-w-11"
            aria-label="Next month"
            disabled={!hasNextMonth(view, today)}
            onClick={() => setView(shiftMonth(view, 1))}
          >
            <ChevronRight aria-hidden />
          </Button>
        </div>

        <div role="group" aria-label={monthLabel(view)} className="grid grid-cols-7 gap-y-1 text-center">
          {names.map((n) => (
            <span key={n.long} className="text-muted-foreground flex h-8 items-center justify-center text-sm font-medium">
              <span aria-hidden>{n.short}</span>
              <span className="sr-only">{n.long}</span>
            </span>
          ))}
          {Array.from({ length: leadingBlanks(view) }, (_, i) => (
            <span key={`blank-${i}`} aria-hidden />
          ))}
          {days.map((d) => {
            const selected = d === date
            const isToday = d === today
            const has = withFood.has(d)
            const openDay = isOpenDay(d, today)
            return (
              <button
                key={d}
                ref={(el) => {
                  if (el) cells.current.set(d, el)
                  else cells.current.delete(d)
                }}
                type="button"
                disabled={!openDay}
                tabIndex={d === tabbable ? 0 : -1}
                aria-current={isToday ? 'date' : undefined}
                aria-pressed={selected}
                aria-label={`${longDate(d)}${isToday ? ', today' : ''}${has ? ', food logged' : ''}`}
                className={cn(
                  'relative mx-auto flex h-11 w-11 items-center justify-center rounded-full text-[15px] tabular-nums transition-colors duration-150 motion-reduce:transition-none',
                  selected
                    ? 'bg-primary text-primary-foreground font-semibold'
                    : 'hover:bg-muted disabled:hover:bg-transparent',
                  isToday && !selected && 'ring-border-strong font-semibold ring-1',
                  !openDay && 'text-muted-foreground/50',
                )}
                onFocus={() => setFocusDay(d)}
                onKeyDown={(e) => onKey(e, d)}
                onClick={() => onPick(d)}
              >
                {Number(d.slice(8))}
                {has && <span aria-hidden className="absolute bottom-1.5 size-1 rounded-full bg-current" />}
              </button>
            )
          })}
        </div>

        <p className="text-muted-foreground text-sm">A dot marks a day with food logged.</p>
      </div>

      {date !== today && (
        <div className="bg-popover shrink-0 border-t px-5 py-4">
          <Button type="button" variant="outline" className="h-12 w-full" onClick={() => (onPick(today), onClose())}>
            Go to today
          </Button>
        </div>
      )}
    </div>
  )
}
