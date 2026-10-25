import {
  ConflictError,
  DAY_COLORS,
  LIMITS,
  ValidationError,
  newId,
  planSessionSets,
  type DayColor,
} from '@workout/shared'
import { Check } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { AngleChip } from '@/components/plan-bits'
import { Button } from '@/components/ui/button'
import { DAY_COLOR_NAMES, dayColorOf, dayColorVar } from '@/lib/day-colors'
import { notifyError } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { useSavePlanDay, useSetSuperset } from '@/repo/hooks'
import type { PlanTree } from '@/repo/types'

type Day = PlanTree['days'][number]
type Item = Day['items'][number]

/** Toggle button showing the day's colour; opens the swatch picker. */
export function DayColorButton({ day, open, onToggle }: { day: Day; open: boolean; onToggle: () => void }) {
  const color = dayColorOf(day)
  return (
    <Button
      variant="ghost"
      size="icon"
      className="min-h-11 min-w-11"
      aria-expanded={open}
      aria-label={`Colour for ${day.name}: ${DAY_COLOR_NAMES[color]}`}
      onClick={onToggle}
    >
      <span aria-hidden className="size-6 rounded-full border-2 border-current" style={{ background: dayColorVar(color) }} />
    </Button>
  )
}

/** Radio swatches: Automatic (derived from the position) plus the eight named colours. */
export function DayColorPicker({ day, planId }: { day: Day; planId: string }) {
  const save = useSavePlanDay()
  const derived = dayColorOf({ color: null, position: day.position })
  const choices: { value: DayColor | null; label: string; swatch: DayColor }[] = [
    { value: null, label: `Automatic (${DAY_COLOR_NAMES[derived]})`, swatch: derived },
    ...DAY_COLORS.map((c) => ({ value: c, label: DAY_COLOR_NAMES[c], swatch: c })),
  ]
  const name = `day-color-${day.id}`
  return (
    <div role="radiogroup" aria-label={`Colour for ${day.name}`} className="flex flex-wrap gap-1">
      {choices.map((c) => {
        const checked = day.color === c.value
        return (
          <label key={c.label} className="relative flex size-11 cursor-pointer items-center justify-center rounded-full">
            <input
              type="radio"
              name={name}
              className="peer sr-only"
              aria-label={c.label}
              checked={checked}
              onChange={() =>
                save.mutate(
                  { id: day.id, plan_id: planId, name: day.name, color: c.value },
                  { onError: (e) => notifyError(e) },
                )
              }
            />
            <span
              aria-hidden
              className={cn(
                'flex size-9 items-center justify-center rounded-full text-[11px] font-bold uppercase',
                'peer-focus-visible:outline-ring peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2',
                checked && 'ring-foreground ring-offset-card ring-2 ring-offset-2',
              )}
              style={{ background: dayColorVar(c.swatch), color: 'var(--day-foreground)' }}
            >
              {checked ? <Check className="size-5" strokeWidth={3} /> : c.value === null ? 'Auto' : null}
            </span>
          </label>
        )
      })}
    </div>
  )
}

export type DayBlock =
  | { kind: 'item'; item: Item; index: number }
  | { kind: 'superset'; groupId: string; letter: string; members: { item: Item; index: number; label: string }[] }

/**
 * Day items as display blocks: a superset's members are pulled together at the first member's
 * position, as at session start (labels come from the same planSessionSets layout).
 */
export function dayBlocks(items: Item[]): DayBlock[] {
  const labels = new Map(
    planSessionSets(items.map((i) => ({ id: i.id, position: i.position, sets: 1, superset_group: i.superset_group }))).map(
      (s) => [s.plan_item_id, s.superset_label] as const,
    ),
  )
  const blocks: DayBlock[] = []
  const seen = new Set<string>()
  items.forEach((item, index) => {
    const label = labels.get(item.id)
    if (!item.superset_group || !label) {
      blocks.push({ kind: 'item', item, index })
      return
    }
    if (seen.has(item.superset_group)) return
    seen.add(item.superset_group)
    const members = items
      .map((m, i) => ({ item: m, index: i, label: labels.get(m.id) ?? '' }))
      .filter((m) => m.item.superset_group === item.superset_group)
    blocks.push({ kind: 'superset', groupId: item.superset_group, letter: label.slice(0, 1), members })
  })
  return blocks
}

export function supersetError(err: unknown) {
  if (err instanceof ValidationError) {
    console.error(err)
    toast.error(err.message)
  } else if (err instanceof ConflictError) {
    console.error(err)
    toast.error('This superset changed somewhere else. Reload and try again.')
  } else notifyError(err, "Couldn't change the superset")
}

/** Multi-select of the day's items, linked into a new superset group. */
export function SupersetPicker({ day, onDone }: { day: Day; onDone: () => void }) {
  const setSuperset = useSetSuperset()
  const [ids, setIds] = useState<string[]>([])
  const full = ids.length >= LIMITS.supersetMax
  const ready = ids.length >= LIMITS.supersetMin
  return (
    <div role="group" aria-label="Pick 2-3 exercises to link" className="flex flex-col gap-2">
      <p className="text-muted-foreground text-sm">
        Pick 2-3 exercises to do back to back. One already in a superset moves to the new one.
      </p>
      <ul className="divide-y border-y">
        {day.items.map((item) => {
          const checked = ids.includes(item.id)
          return (
            <li key={item.id}>
              <label className="flex min-h-12 items-center gap-3 py-1 text-base">
                <input
                  type="checkbox"
                  className="size-5"
                  aria-label={item.exercise.name}
                  checked={checked}
                  disabled={!checked && full}
                  onChange={(e) =>
                    setIds((cur) => (e.target.checked ? [...cur, item.id] : cur.filter((x) => x !== item.id)))
                  }
                />
                <span className="min-w-0 flex-1 font-medium">
                  {item.exercise.name}
                  <AngleChip angle={item.angle} />
                </span>
              </label>
            </li>
          )
        })}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button
          className="min-h-11"
          disabled={!ready || setSuperset.isPending}
          onClick={() => {
            // Keep the day order, not the tap order
            const ordered = day.items.filter((i) => ids.includes(i.id)).map((i) => i.id)
            setSuperset.mutate(
              { planDayId: day.id, groupId: newId(), itemIds: ordered },
              { onSuccess: onDone, onError: supersetError },
            )
          }}
        >
          Link as superset{ready ? ` (${ids.length})` : ''}
        </Button>
        <Button variant="ghost" className="min-h-11" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
