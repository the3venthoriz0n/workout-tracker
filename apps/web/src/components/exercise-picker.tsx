import { isExerciseAvailable } from '@workout/shared'
import { useState } from 'react'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useExercises, useGear } from '@/repo/hooks'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (exerciseId: string) => void
}

export function ExercisePicker({ open, onOpenChange, onPick }: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[92dvh]">
        {open && (
          <PickerBody
            onPick={(id) => {
              onPick(id)
              onOpenChange(false)
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

function PickerBody({ onPick }: { onPick: (exerciseId: string) => void }) {
  const exercises = useExercises()
  const gear = useGear()
  const [query, setQuery] = useState('')

  const owned = new Set((gear.data ?? []).filter((g) => g.owned).map((g) => g.id))
  const available = (exercises.data ?? []).filter((ex) => isExerciseAvailable(ex, owned))
  const q = query.trim().toLowerCase()
  const shown = q ? available.filter((ex) => ex.name.toLowerCase().includes(q)) : available

  return (
    <div className="flex min-h-0 flex-col gap-3 p-4">
      <SheetHeader className="p-0">
        <SheetTitle>Add exercise</SheetTitle>
        <SheetDescription>Pick an exercise to add to this day.</SheetDescription>
      </SheetHeader>
      <Input
        className="min-h-11"
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        aria-label="Search exercises"
        placeholder="Search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {available.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No exercises available. Exercises that are inactive, or that need gear you do not own,
          are hidden. Change this in Library (Exercises or Gear).
        </p>
      ) : shown.length === 0 ? (
        <p className="text-muted-foreground text-sm">No exercises match your search.</p>
      ) : (
        <ul className="flex min-h-0 flex-col divide-y overflow-y-auto overscroll-contain">
          {shown.map((ex) => (
            <li key={ex.id}>
              <button
                type="button"
                className="hover:bg-accent flex min-h-12 w-full items-center rounded-md px-2 text-left font-semibold"
                onClick={() => onPick(ex.id)}
              >
                {ex.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
