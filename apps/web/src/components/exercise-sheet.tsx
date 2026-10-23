import { exerciseInputSchema, type Exercise } from '@workout/shared'
import { useState } from 'react'
import { toast } from 'sonner'
import { notifyError } from '@/lib/notify'
import { NumberField } from '@/components/number-field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useGear, useProfile, useSaveExercise } from '@/repo/hooks'

type Props = {
  exercise?: Exercise
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ExerciseSheet({ exercise, open, onOpenChange }: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto">
        {open && <ExerciseForm exercise={exercise} onDone={() => onOpenChange(false)} />}
      </SheetContent>
    </Sheet>
  )
}

function ExerciseForm({ exercise, onDone }: { exercise?: Exercise; onDone: () => void }) {
  const gear = useGear().data ?? []
  const units = useProfile().data?.units ?? 'lb'
  const save = useSaveExercise()

  const [name, setName] = useState(exercise?.name ?? '')
  const [notes, setNotes] = useState(exercise?.notes ?? '')
  const [videoUrl, setVideoUrl] = useState(exercise?.video_url ?? '')
  const [gearIds, setGearIds] = useState<string[]>(exercise?.required_gear_ids ?? [])
  const [active, setActive] = useState(exercise?.active ?? true)
  const [sets, setSets] = useState<number | null>(exercise?.default_sets ?? 3)
  const [reps, setReps] = useState<number | null>(exercise?.default_reps ?? 5)
  const [weight, setWeight] = useState<number | null>(exercise?.default_weight ?? 0)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const sortedGear = [...gear].sort((a, b) => a.name.localeCompare(b.name))

  function toggleGear(id: string, on: boolean) {
    setGearIds((ids) => (on ? [...ids, id] : ids.filter((g) => g !== id)))
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (save.isPending) return
    const parsed = exerciseInputSchema.safeParse({
      ...(exercise ? { id: exercise.id } : {}),
      name,
      notes,
      video_url: videoUrl.trim() === '' ? null : videoUrl.trim(),
      required_gear_ids: gearIds,
      active,
      default_sets: sets,
      default_reps: reps,
      default_weight: weight,
    })
    if (!parsed.success) {
      const next: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'form')
        next[key] ??= fieldMessage(key)
      }
      setErrors(next)
      return
    }
    setErrors({})
    save.mutate(parsed.data, {
      onSuccess: () => {
        toast.success(exercise ? 'Exercise saved' : 'Exercise added')
        onDone()
      },
      onError: (err) => notifyError(err, "Couldn't save the exercise"),
    })
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4 overflow-y-auto p-4">
      <SheetHeader className="p-0">
        <SheetTitle>{exercise ? 'Edit exercise' : 'Add exercise'}</SheetTitle>
        <SheetDescription>Defaults apply when you add it to a plan.</SheetDescription>
      </SheetHeader>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ex-name">Name</Label>
        <Input
          id="ex-name"
          className="min-h-11"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={!!errors.name}
        />
        {errors.name && <p className="text-destructive text-sm">{errors.name}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ex-video">Video link</Label>
        <Input
          id="ex-video"
          className="min-h-11"
          inputMode="url"
          placeholder="https://"
          value={videoUrl}
          onChange={(e) => setVideoUrl(e.target.value)}
          aria-invalid={!!errors.video_url}
        />
        {errors.video_url && <p className="text-destructive text-sm">{errors.video_url}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ex-notes">Notes</Label>
        <Textarea id="ex-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-sm font-medium">Required gear</legend>
        {sortedGear.map((g) => (
          <label key={g.id} className="flex min-h-11 items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="size-5"
              checked={gearIds.includes(g.id)}
              onChange={(e) => toggleGear(g.id, e.target.checked)}
            />
            {g.name}
          </label>
        ))}
      </fieldset>

      <div className="grid grid-cols-3 gap-3">
        <NumberField label="Sets" kind="reps" value={sets} onCommit={setSets} />
        <NumberField label="Reps" kind="reps" value={reps} onCommit={setReps} />
        <NumberField label={`Weight (${units})`} kind="weight" value={weight} onCommit={setWeight} />
      </div>
      {(errors.default_sets || errors.default_reps || errors.default_weight) && (
        <p className="text-destructive text-sm">
          {errors.default_sets ?? errors.default_reps ?? errors.default_weight}
        </p>
      )}

      <label className="flex min-h-11 items-center justify-between gap-3 text-sm font-medium">
        Active
        <Switch checked={active} onCheckedChange={setActive} aria-label="Active" />
      </label>

      <SheetFooter className="flex-row flex-wrap gap-2 p-0">
        <Button type="submit" className="min-h-11 flex-1" disabled={save.isPending}>
          Save
        </Button>
      </SheetFooter>
    </form>
  )
}

function fieldMessage(key: string) {
  switch (key) {
    case 'name':
      return 'Name is required.'
    case 'video_url':
      return 'Enter a valid http(s) link.'
    case 'default_sets':
      return 'Sets must be at least 1.'
    case 'default_reps':
      return 'Reps must be at least 1.'
    case 'default_weight':
      return 'Weight must be 0 or more.'
    default:
      return 'Invalid value.'
  }
}
