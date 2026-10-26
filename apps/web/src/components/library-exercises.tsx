import { Plus, Video } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { SkeletonRows } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { DeleteConfirm, focusLibraryPanel, RowActions, useRestoreFocus } from '@/components/row-actions'
import { formatWeight, pluralize } from '@/lib/format'
import { isHttpUrl } from '@/lib/links'
import { notifyError } from '@/lib/notify'
import { listGroup } from '@/lib/styles'
import { cn } from '@/lib/utils'
import {
  useDeleteExercise,
  useExercises,
  useExerciseUsage,
  useGear,
  useProfile,
  useSaveExercise,
} from '@/repo/hooks'
import type { Exercise } from '@workout/shared'

export function LibraryExercises({
  onEdit,
  onAdd,
}: {
  onEdit: (exercise: Exercise) => void
  onAdd?: () => void
}) {
  const exercises = useExercises()
  const gear = useGear()
  const units = useProfile().data?.units ?? 'lb'

  const gearNames = new Map((gear.data ?? []).map((g) => [g.id, g.name]))
  const list = exercises.data ?? []

  return (
    <div className="flex flex-col gap-3 px-4 pb-6">
      {exercises.isPending && <SkeletonRows />}
      {exercises.isSuccess && list.length === 0 && (
        <div className="flex flex-col items-start gap-3">
          <p className="text-muted-foreground text-sm">
            No exercises yet. Add your first exercise to get started.
          </p>
          {onAdd && (
            <Button type="button" className="min-h-11" onClick={onAdd}>
              <Plus aria-hidden /> Create exercise
            </Button>
          )}
        </div>
      )}

      <ul className={cn(listGroup, list.length === 0 && 'hidden')}>
        {list.map((ex) => (
          <ExerciseRow
            key={ex.id}
            exercise={ex}
            units={units}
            gearNames={gearNames}
            onEdit={() => onEdit(ex)}
          />
        ))}
      </ul>
    </div>
  )
}

function ExerciseRow({
  exercise: ex,
  units,
  gearNames,
  onEdit,
}: {
  exercise: Exercise
  units: string
  gearNames: Map<string, string>
  onEdit: () => void
}) {
  const save = useSaveExercise()
  const remove = useDeleteExercise()
  const [confirming, setConfirming] = useState(false)
  const usage = useExerciseUsage(ex.id, confirming)
  const trashRef = useRestoreFocus(confirming)

  const gearLabel =
    ex.required_gear_ids.map((id) => gearNames.get(id)).filter(Boolean).join(', ') || 'No gear'
  const status: 'checking' | 'error' | 'ready' = usage.isFetching
    ? 'checking'
    : usage.isSuccess
      ? 'ready'
      : usage.isError
        ? 'error'
        : 'checking'
  const impact =
    usage.isSuccess && usage.data.planItemCount > 0
      ? `Used in ${pluralize(usage.data.planItemCount, 'plan item')} in: ${usage.data.plans.join(', ')}. Deleting also removes it from those plans. Past workouts keep their records.`
      : "This can't be undone."

  return (
    <li className="flex flex-col py-1.5 pr-1.5 pl-4">
      <div className="flex items-center gap-2">
        <div className="flex min-h-11 min-w-0 flex-1 flex-col items-start gap-1 py-2 text-left">
          <span className={ex.active ? 'text-[17px] font-semibold' : 'text-muted-foreground text-[17px] font-semibold'}>
            {ex.name}
          </span>
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="bg-background">{gearLabel}</Badge>
            <span className="text-muted-foreground text-sm tabular-nums">
              {ex.default_sets}×{ex.default_reps} @ {formatWeight(ex.default_weight)} {units}
            </span>
          </span>
        </div>
        {ex.video_url && isHttpUrl(ex.video_url) && (
          <a
            href={ex.video_url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Video for ${ex.name}`}
            className="text-muted-foreground hover:text-foreground hover:bg-accent flex min-h-11 min-w-11 items-center justify-center rounded-full"
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
        {!confirming && (
          <RowActions trashRef={trashRef} name={ex.name} onEdit={onEdit} onDelete={() => setConfirming(true)} />
        )}
      </div>
      {confirming && (
        <DeleteConfirm
          name={ex.name}
          subject="exercise"
          impact={impact}
          status={status}
          onRetry={() => void usage.refetch()}
          pending={remove.isPending}
          onCancel={() => setConfirming(false)}
          onConfirm={() =>
            remove.mutate(ex.id, {
              onSuccess: () => {
                toast.success('Exercise deleted')
                focusLibraryPanel()
              },
              onError: (err) => {
                setConfirming(false)
                notifyError(err, "Couldn't delete that exercise")
              },
            })
          }
        />
      )}
    </li>
  )
}
