import { isExerciseAvailable } from '@workout/shared'
import { Plus } from 'lucide-react'
import { useId, useState } from 'react'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { formatWeight } from '@/lib/format'
import { isDesktop, responsiveSheet } from '@/lib/sheet-classes'
import { useExercises, useGear, useProfile } from '@/repo/hooks'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (exerciseId: string) => void
  // Called with the typed name (possibly empty) when the user wants a new exercise instead
  onCreate?: (name: string) => void
}

export function ExercisePicker({ open, onOpenChange, onPick, onCreate }: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className={responsiveSheet}
        // Phones: keep the keyboard down until the user taps the search box
        onOpenAutoFocus={(e) => {
          if (!isDesktop()) e.preventDefault()
        }}
      >
        {open && (
          <PickerBody
            onPick={(id) => {
              onPick(id)
              onOpenChange(false)
            }}
            onCreate={
              onCreate
                ? (name) => {
                    onCreate(name)
                    onOpenChange(false)
                  }
                : undefined
            }
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

function PickerBody({
  onPick,
  onCreate,
}: {
  onPick: (exerciseId: string) => void
  onCreate?: (name: string) => void
}) {
  const exercises = useExercises()
  const gear = useGear()
  const units = useProfile().data?.units ?? 'lb'
  const [query, setQuery] = useState('')
  const baseId = useId()

  const owned = new Set((gear.data ?? []).filter((g) => g.owned).map((g) => g.id))
  const gearNames = new Map((gear.data ?? []).map((g) => [g.id, g.name]))
  const available = (exercises.data ?? []).filter((ex) => isExerciseAvailable(ex, owned))
  const q = query.trim().toLowerCase()
  const shown = q ? available.filter((ex) => ex.name.toLowerCase().includes(q)) : available
  const canCreate = !!onCreate && q !== '' && !available.some((ex) => ex.name.trim().toLowerCase() === q)
  const loaded = exercises.isSuccess

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SheetHeader className="shrink-0 pr-14">
        <SheetTitle>Add exercise</SheetTitle>
        <SheetDescription>Pick an exercise to add to this day.</SheetDescription>
      </SheetHeader>
      <div className="shrink-0 px-5 pb-3">
        <Input
          className="rounded-full px-5"
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          aria-label="Search exercises"
          placeholder="Search"
          autoFocus={isDesktop()}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4">
        {loaded && available.length === 0 && (
          <div className="flex flex-col items-start gap-3 px-2">
            <p className="text-muted-foreground px-2 text-sm">
              No exercises available. Exercises that are inactive, or that need gear you do not own,
              are hidden. Change this in Library (Exercises or Gear).
            </p>
            {onCreate && q === '' && (
              <button
                type="button"
                className="bg-primary text-primary-foreground hover:bg-primary/85 inline-flex min-h-11 items-center gap-2 rounded-full px-5 font-semibold"
                onClick={() => onCreate?.('')}
              >
                <Plus className="size-4" aria-hidden /> Create exercise
              </button>
            )}
          </div>
        )}
        {loaded && available.length > 0 && shown.length === 0 && (
          <p className="text-muted-foreground px-2 pb-2 text-sm">No exercises match your search.</p>
        )}
        <ul className="flex flex-col gap-0.5">
          {canCreate && (
            <li>
              <button
                type="button"
                className="hover:bg-accent text-brand flex min-h-12 w-full items-center gap-2 rounded-row px-3 text-left font-semibold"
                onClick={() => onCreate?.(query.trim())}
              >
                <Plus className="size-4 shrink-0" aria-hidden />
                <span className="min-w-0 truncate">Create &quot;{query.trim()}&quot;</span>
              </button>
            </li>
          )}
          {shown.map((ex) => {
            const gearLabel = ex.required_gear_ids
              .map((id) => gearNames.get(id))
              .filter(Boolean)
              .join(', ')
            const detail = `${ex.default_sets}×${ex.default_reps} @ ${formatWeight(ex.default_weight)} ${units}${gearLabel ? ` · ${gearLabel}` : ''}`
            const detailId = `${baseId}-${ex.id}`
            return (
              <li key={ex.id}>
                <button
                  type="button"
                  aria-label={ex.name}
                  aria-describedby={detailId}
                  className="hover:bg-accent flex min-h-14 w-full flex-col items-start justify-center rounded-row px-3 py-2 text-left"
                  onClick={() => onPick(ex.id)}
                >
                  <span className="font-semibold">{ex.name}</span>
                  <span id={detailId} className="text-muted-foreground text-sm tabular-nums">
                    {detail}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
