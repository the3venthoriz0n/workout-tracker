import { ChevronDown, ChevronUp, Plus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Link, useParams } from 'react-router'
import { SettingsLink } from '@/app/screen'
import { ExercisePicker } from '@/components/exercise-picker'
import { ExerciseSheet } from '@/components/exercise-sheet'
import { PlanItemRow } from '@/components/plan-item-row'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { notifyError } from '@/lib/notify'
import {
  useAddPlanItem,
  useDeletePlanDay,
  useMove,
  usePlan,
  useSavePlan,
  useSavePlanDay,
} from '@/repo/hooks'

// Commits on blur/Enter; empty input reverts to the saved name.
function InlineName({
  value,
  label,
  className,
  onCommit,
}: {
  value: string
  label: string
  className?: string
  onCommit: (name: string) => void
}) {
  const [text, setText] = useState(value)
  const [seen, setSeen] = useState(value)
  if (seen !== value) {
    setSeen(value)
    setText(value)
  }
  function commit() {
    const trimmed = text.trim()
    if (!trimmed) {
      setText(value)
      return
    }
    if (trimmed !== value) onCommit(trimmed)
    setText(trimmed)
  }
  return (
    <Input
      className={className}
      aria-label={label}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          e.currentTarget.blur()
        }
      }}
    />
  )
}

export function PlanDetailScreen() {
  const { id = '' } = useParams()
  const plan = usePlan(id)
  const savePlan = useSavePlan()
  const saveDay = useSavePlanDay()
  const removeDay = useDeletePlanDay()
  const moveDay = useMove()
  const addItem = useAddPlanItem()
  const [pickerDay, setPickerDay] = useState<string | null>(null)
  const [creating, setCreating] = useState<{ dayId: string; name: string } | null>(null)
  const [confirmDay, setConfirmDay] = useState<string | null>(null)

  if (plan.isPending) return <div className="p-4" aria-busy="true" />
  const tree = plan.data
  if (!tree) {
    return (
      <div className="flex flex-col items-start gap-3 p-4">
        <h1 className="text-2xl font-semibold">Plan not found</h1>
        <Link to="/plans" className="inline-flex min-h-11 items-center underline">
          Back to plans
        </Link>
      </div>
    )
  }

  const creatingDay = tree.days.find((d) => d.id === creating?.dayId)

  return (
    <div className="flex flex-col gap-3 px-4 pb-4">
      <div className="bg-background sticky top-0 z-30 -mx-4 flex items-center justify-between pt-[env(safe-area-inset-top)] pr-2 pl-4">
        <Link to="/plans" className="text-muted-foreground inline-flex min-h-11 items-center text-base font-medium">
          ← Plans
        </Link>
        <SettingsLink />
      </div>
      <InlineName
        label="Plan name"
        className="font-heading min-h-12 text-2xl font-bold md:text-2xl"
        value={tree.name}
        onCommit={(name) => savePlan.mutate({ id: tree.id, name }, { onError: (e) => notifyError(e) })}
      />

      {tree.days.length === 0 && (
        <p className="text-muted-foreground text-sm">No days yet. Add a day to start building.</p>
      )}

      {tree.days.map((day, di) => (
        <section
          key={day.id}
          aria-label={`Day ${day.name}`}
          className="bg-card flex flex-col gap-3 rounded-lg border p-3"
        >
          <div className="flex items-center gap-2">
            <InlineName
              label="Day name"
              className="font-heading min-h-11 flex-1 text-xl font-bold"
              value={day.name}
              onCommit={(name) =>
                saveDay.mutate({ id: day.id, plan_id: tree.id, name }, { onError: (e) => notifyError(e) })
              }
            />
            <Button
              variant="ghost"
              size="icon"
              className="min-h-11 min-w-11"
              aria-label={`Move ${day.name} up`}
              disabled={di === 0 || moveDay.isPending}
              onClick={() =>
                moveDay.mutate({ kind: 'day', id: day.id, direction: -1 }, { onError: (e) => notifyError(e) })
              }
            >
              <ChevronUp aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="min-h-11 min-w-11"
              aria-label={`Move ${day.name} down`}
              disabled={di === tree.days.length - 1 || moveDay.isPending}
              onClick={() =>
                moveDay.mutate({ kind: 'day', id: day.id, direction: 1 }, { onError: (e) => notifyError(e) })
              }
            >
              <ChevronDown aria-hidden />
            </Button>
          </div>

          {day.items.length === 0 && (
            <p className="text-muted-foreground text-sm">No exercises on this day yet.</p>
          )}
          <ul className="divide-y border-y">
            {day.items.map((item, i) => (
              <PlanItemRow
                key={item.id}
                item={item}
                isFirst={i === 0}
                isLast={i === day.items.length - 1}
              />
            ))}
          </ul>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="min-h-11"
              aria-label={`Add exercise to ${day.name}`}
              onClick={() => setPickerDay(day.id)}
            >
              <Plus aria-hidden /> Add exercise
            </Button>
            {confirmDay === day.id ? (
              <>
                <Button
                  variant="destructive"
                  className="min-h-11"
                  aria-label={`Confirm delete ${day.name}`}
                  onClick={() =>
                    removeDay.mutate(day.id, {
                      onSuccess: () => setConfirmDay(null),
                      onError: (e) => notifyError(e),
                    })
                  }
                >
                  Confirm delete
                </Button>
                <Button variant="ghost" className="min-h-11" onClick={() => setConfirmDay(null)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive min-h-11"
                aria-label={`Delete ${day.name}`}
                onClick={() => setConfirmDay(day.id)}
              >
                Delete day
              </Button>
            )}
          </div>
        </section>
      ))}

      <Button
        className="min-h-11 self-start"
        disabled={saveDay.isPending}
        onClick={() =>
          saveDay.mutate(
            { plan_id: tree.id, name: `Day ${String.fromCharCode(65 + (tree.days.length % 26))}` },
            { onError: (e) => notifyError(e) },
          )
        }
      >
        <Plus aria-hidden /> Add day
      </Button>

      <ExercisePicker
        open={pickerDay !== null}
        onOpenChange={(open) => !open && setPickerDay(null)}
        onPick={(exerciseId) => {
          if (pickerDay) addItem.mutate({ planDayId: pickerDay, exerciseId }, { onError: (e) => notifyError(e) })
        }}
        onCreate={(name) => pickerDay && setCreating({ dayId: pickerDay, name })}
      />
      <ExerciseSheet
        open={creating !== null}
        onOpenChange={(open) => !open && setCreating(null)}
        initialName={creating?.name}
        submitLabel={`Save and add to ${creatingDay?.name ?? 'day'}`}
        onSaved={async (exercise) => {
          if (!creating) return
          const dayName = creatingDay?.name ?? 'the day'
          try {
            await addItem.mutateAsync({ planDayId: creating.dayId, exerciseId: exercise.id })
            toast.success(`Added ${exercise.name} to ${dayName}`)
          } catch (e) {
            // The exercise exists now; only the plan item is missing
            notifyError(e, `Saved ${exercise.name}, but couldn't add it to ${dayName}. Add it from the picker.`)
          }
        }}
      />
    </div>
  )
}
