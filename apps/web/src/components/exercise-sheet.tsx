import { exerciseInputSchema, type Exercise } from '@workout/shared'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { notifyError } from '@/lib/notify'
import { responsiveSheet } from '@/lib/sheet-classes'
import { cn } from '@/lib/utils'
import { Disclosure } from '@/components/disclosure'
import { ExerciseProgression } from '@/components/exercise-progression'
import { NumberField } from '@/components/number-field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
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
  // Create flow: prefill the name, relabel Save, and follow up once the exercise exists.
  // When onSaved is set, the caller owns the toasts after a successful save.
  initialName?: string
  submitLabel?: string
  onSaved?: (exercise: Exercise) => Promise<void> | void
}

export function ExerciseSheet({ exercise, open, onOpenChange, ...flow }: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className={responsiveSheet}>
        {open && <ExerciseForm exercise={exercise} onDone={() => onOpenChange(false)} {...flow} />}
      </SheetContent>
    </Sheet>
  )
}

function ExerciseForm({
  exercise,
  onDone,
  initialName,
  submitLabel = 'Save',
  onSaved,
}: { exercise?: Exercise; onDone: () => void } & Pick<
  Props,
  'initialName' | 'submitLabel' | 'onSaved'
>) {
  const gear = useGear().data ?? []
  const units = useProfile().data?.units ?? 'lb'
  const save = useSaveExercise()
  const submitted = useRef(false)

  const [name, setName] = useState(exercise?.name ?? initialName ?? '')
  const [notes, setNotes] = useState(exercise?.notes ?? '')
  const [videoUrl, setVideoUrl] = useState(exercise?.video_url ?? '')
  const [gearIds, setGearIds] = useState<string[]>(exercise?.required_gear_ids ?? [])
  // Active is switched on the Library tile; the editor just keeps whatever it is
  const active = exercise?.active ?? true
  const [supportsAngle, setSupportsAngle] = useState(exercise?.supports_angle ?? false)
  const [sets, setSets] = useState<number | null>(exercise?.default_sets ?? 3)
  const [reps, setReps] = useState<number | null>(exercise?.default_reps ?? 5)
  const [weight, setWeight] = useState<number | null>(exercise?.default_weight ?? 0)
  // Always starts closed; the row under it says what is set inside
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const sortedGear = [...gear].sort((a, b) => a.name.localeCompare(b.name))
  const angleWarning = !!exercise?.supports_angle && !supportsAngle
  const detailsSummary =
    [
      gearIds.length > 0 && sortedGear.filter((g) => gearIds.includes(g.id)).map((g) => g.name).join(', '),
      videoUrl.trim() !== '' && 'Video',
      notes.trim() !== '' && 'Notes',
    ]
      .filter(Boolean)
      .join(' · ') || 'Gear, video, notes'

  function toggleGear(id: string, on: boolean) {
    setGearIds((ids) => (on ? [...ids, id] : ids.filter((g) => g !== id)))
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (submitted.current) return
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
      supports_angle: supportsAngle,
    })
    if (!parsed.success) {
      const next: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'form')
        next[key] ??= fieldMessage(key)
      }
      setErrors(next)
      if (next.video_url) setDetailsOpen(true)
      return
    }
    setErrors({})
    submitted.current = true
    save.mutate(parsed.data, {
      onSuccess: (saved) => {
        if (onSaved) void onSaved(saved)
        else toast.success(exercise ? 'Exercise saved' : 'Exercise added')
        onDone()
      },
      onError: (err) => {
        submitted.current = false
        notifyError(err, "Couldn't save the exercise")
      },
    })
  }

  return (
    <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
      <SheetHeader className="shrink-0 pr-14">
        <SheetTitle>{exercise ? 'Edit exercise' : 'Add exercise'}</SheetTitle>
        <SheetDescription className="sr-only">Defaults apply when you add it to a plan.</SheetDescription>
      </SheetHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain px-5 pb-5">
        {/* What an exercise is: its name and its working numbers */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ex-name">Name</Label>
            <Input
              id="ex-name"
              autoComplete="off"
              enterKeyHint="next"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={!!errors.name}
            />
            {errors.name && <p className="text-destructive text-sm">{errors.name}</p>}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <NumberField label="Sets" kind="reps" value={sets} onCommit={setSets} />
            <NumberField label="Reps" kind="reps" value={reps} onCommit={setReps} />
            <NumberField
              label={`Weight (${units})`}
              kind="weight"
              value={weight}
              onCommit={setWeight}
            />
          </div>
          {(errors.default_sets || errors.default_reps || errors.default_weight) && (
            <p className="text-destructive -mt-2 text-sm">
              {errors.default_sets ?? errors.default_reps ?? errors.default_weight}
            </p>
          )}

          <div className="flex flex-col">
            <label className="flex min-h-11 items-center justify-between gap-3 text-sm font-medium">
              Has angle (flat / incline / decline)
              <Switch
                checked={supportsAngle}
                onCheckedChange={setSupportsAngle}
                aria-label="Has angle (flat / incline / decline)"
                aria-describedby={angleWarning ? 'ex-angle-help' : undefined}
              />
            </label>
            {angleWarning && (
              <p id="ex-angle-help" className="text-muted-foreground -mt-1 text-sm">
                Turning it off clears the angle on its plan items.
              </p>
            )}
          </div>
        </div>

        {/* Everything else sits behind two matching dropdowns, each saying what is inside */}
        <div className="flex flex-col gap-3">
          <Disclosure
            id="ex-details"
            title="Optional details"
            label="Optional details"
            summary={detailsSummary}
            open={detailsOpen}
            onToggle={() => setDetailsOpen((o) => !o)}
          >
            {sortedGear.length > 0 && (
              <fieldset className="flex flex-col">
                <legend className="mb-1 text-sm font-medium">Required gear</legend>
                {sortedGear.map((g) => (
                  <label key={g.id} className="flex min-h-11 items-center gap-3 text-sm">
                    <input
                      type="checkbox"
                      className="accent-brand size-5"
                      checked={gearIds.includes(g.id)}
                      onChange={(e) => toggleGear(g.id, e.target.checked)}
                    />
                    {g.name}
                  </label>
                ))}
              </fieldset>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ex-video">Video link</Label>
              <Input
                id="ex-video"
                inputMode="url"
                autoComplete="off"
                autoCapitalize="off"
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
          </Disclosure>

          {/* Only an existing exercise has a rule of its own to edit; it saves as you change it */}
          {exercise && <ExerciseProgression exerciseId={exercise.id} name={exercise.name} />}
        </div>
      </div>

      <div className="bg-popover shrink-0 border-t px-5 py-4">
        <Button type="submit" size="big" className="w-full" disabled={save.isPending}>
          {submitLabel}
        </Button>
      </div>
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
