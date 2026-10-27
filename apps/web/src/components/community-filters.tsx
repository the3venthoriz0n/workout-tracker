import { LEVELS, type Level } from '@workout/shared'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { LEVEL_NAMES } from '@/lib/community'
import { responsiveSheet } from '@/lib/sheet-classes'
import { pluralize } from '@/lib/format'
import { cn } from '@/lib/utils'

export type CommunityFilters = { days: number | null; level: Level | null; noGear: boolean }
export const NO_FILTERS: CommunityFilters = { days: null, level: null, noGear: false }
export const filterCount = (f: CommunityFilters) => (f.days !== null ? 1 : 0) + (f.level !== null ? 1 : 0) + (f.noGear ? 1 : 0)

const DAY_OPTIONS = [1, 2, 3, 4, 5, 6]

/** A pill radio chip (filters, sort). */
export function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      className={cn(
        'inline-flex min-h-11 shrink-0 items-center rounded-full px-4 text-[15px] font-medium transition-colors duration-150 motion-reduce:transition-none',
        on ? 'bg-primary text-primary-foreground font-semibold' : 'bg-secondary text-secondary-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

export function CommunityFiltersSheet({
  open,
  value,
  onOpenChange,
  onApply,
}: {
  open: boolean
  value: CommunityFilters
  onOpenChange: (open: boolean) => void
  onApply: (f: CommunityFilters) => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className={responsiveSheet}>
        {open && <FiltersForm initial={value} onApply={(f) => (onApply(f), onOpenChange(false))} />}
      </SheetContent>
    </Sheet>
  )
}

function FiltersForm({ initial, onApply }: { initial: CommunityFilters; onApply: (f: CommunityFilters) => void }) {
  const [f, setF] = useState(initial)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SheetHeader className="shrink-0 pr-14">
        <SheetTitle>Filters</SheetTitle>
        <SheetDescription>Narrow the community list.</SheetDescription>
      </SheetHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain px-5 pb-5">
        <div className="flex flex-col gap-2">
          <h3 id="f-days" className="text-sm font-medium">Days per week</h3>
          <div role="radiogroup" aria-labelledby="f-days" className="flex flex-wrap gap-2">
            <Chip on={f.days === null} onClick={() => setF({ ...f, days: null })}>Any</Chip>
            {DAY_OPTIONS.map((d) => (
              <Chip key={d} on={f.days === d} onClick={() => setF({ ...f, days: d })}>
                {pluralize(d, 'day')}
              </Chip>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <h3 id="f-level" className="text-sm font-medium">Level</h3>
          <div role="radiogroup" aria-labelledby="f-level" className="flex flex-wrap gap-2">
            <Chip on={f.level === null} onClick={() => setF({ ...f, level: null })}>Any</Chip>
            {LEVELS.map((l) => (
              <Chip key={l} on={f.level === l} onClick={() => setF({ ...f, level: l })}>
                {LEVEL_NAMES[l]}
              </Chip>
            ))}
          </div>
        </div>
        <label className="flex min-h-11 items-center justify-between gap-3 text-[15px] font-medium">
          <span className="flex flex-col gap-0.5">
            No gear needed
            <span className="text-muted-foreground text-sm font-normal">Only bodyweight exercises</span>
          </span>
          <Switch checked={f.noGear} onCheckedChange={(noGear) => setF({ ...f, noGear })} aria-label="No gear needed" />
        </label>
      </div>
      <div className="bg-popover flex shrink-0 gap-2 border-t px-5 py-4">
        <Button type="button" variant="outline" size="big" className="flex-1" onClick={() => setF(NO_FILTERS)}>
          Reset
        </Button>
        <Button type="button" size="big" className="flex-[2]" onClick={() => onApply(f)}>
          Show plans
        </Button>
      </div>
    </div>
  )
}
