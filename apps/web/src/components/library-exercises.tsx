import { Plus, Video } from 'lucide-react'
import { useState } from 'react'
import { ExerciseSheet } from '@/components/exercise-sheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { formatWeight } from '@/lib/format'
import { isHttpUrl } from '@/lib/links'
import { notifyError } from '@/lib/notify'
import { useExercises, useGear, useProfile, useSaveExercise } from '@/repo/hooks'
import type { Exercise } from '@workout/shared'

type Editing = { exercise?: Exercise } | null

export function LibraryExercises() {
  const exercises = useExercises()
  const gear = useGear()
  const units = useProfile().data?.units ?? 'lb'
  const save = useSaveExercise()
  const [editing, setEditing] = useState<Editing>(null)

  const gearNames = new Map((gear.data ?? []).map((g) => [g.id, g.name]))
  const list = exercises.data ?? []

  return (
    <>
      <div className="flex flex-col gap-3 px-4 pb-4">
        <Button className="min-h-11 self-start" onClick={() => setEditing({})}>
          <Plus aria-hidden /> Add exercise
        </Button>

        {exercises.isSuccess && list.length === 0 && (
          <p className="text-muted-foreground text-sm">
            No exercises yet. Add your first exercise to get started.
          </p>
        )}

        <ul className="flex flex-col gap-2">
          {list.map((ex) => {
            const gearLabel =
              ex.required_gear_ids.map((id) => gearNames.get(id)).filter(Boolean).join(', ') ||
              'No gear'
            return (
              <li key={ex.id} className="bg-card flex items-center gap-2 rounded-lg border p-1">
                <button
                  type="button"
                  className="flex min-h-11 flex-1 flex-col items-start gap-1 rounded-md p-2 text-left"
                  onClick={() => setEditing({ exercise: ex })}
                >
                  <span className={ex.active ? 'font-medium' : 'text-muted-foreground font-medium'}>
                    {ex.name}
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{gearLabel}</Badge>
                    <span className="text-muted-foreground text-sm">
                      {ex.default_sets}×{ex.default_reps} @ {formatWeight(ex.default_weight)} {units}
                    </span>
                  </span>
                </button>
                {ex.video_url && isHttpUrl(ex.video_url) && (
                  <a
                    href={ex.video_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Video for ${ex.name}`}
                    className="text-muted-foreground hover:text-foreground flex min-h-11 min-w-11 items-center justify-center"
                  >
                    <Video className="size-5" aria-hidden />
                  </a>
                )}
                <label className="flex min-h-11 min-w-11 items-center justify-center">
                  <Switch
                    checked={ex.active}
                    aria-label={`${ex.name} active`}
                    disabled={save.isPending}
                    onCheckedChange={(active) => {
                      const { user_id: _u, created_at: _c, updated_at: _up, deleted_at: _d, ...input } = ex
                      save.mutate({ ...input, active }, { onError: (err) => notifyError(err) })
                    }}
                  />
                </label>
              </li>
            )
          })}
        </ul>
      </div>
      <ExerciseSheet
        key={editing?.exercise?.id ?? 'new'}
        exercise={editing?.exercise}
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
      />
    </>
  )
}
