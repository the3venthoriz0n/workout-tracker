import { ChevronDown, ChevronLeft, ChevronUp, Link2, Plus, Share, Unlink } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Link, useParams } from 'react-router'
import { SettingsLink, StickyBar, headerIconButton } from '@/app/screen'
import {
  DayColorButton,
  DayColorPicker,
  SupersetPicker,
  dayBlocks,
  supersetError,
} from '@/components/day-parts'
import { ExercisePicker } from '@/components/exercise-picker'
import { ExerciseSheet } from '@/components/exercise-sheet'
import { DayDot, Rail } from '@/components/plan-bits'
import { PlanItemRow } from '@/components/plan-item-row'
import { ShareSheet } from '@/components/share-sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { dayColorOf } from '@/lib/day-colors'
import { notifyError } from '@/lib/notify'
import {
  useAddPlanItem,
  useDeletePlanDay,
  useMove,
  usePlan,
  useSavePlan,
  useSavePlanDay,
  useSetSuperset,
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
  const [colorDay, setColorDay] = useState<string | null>(null)
  const [linkDay, setLinkDay] = useState<string | null>(null)
  const setSuperset = useSetSuperset()
  const [sharing, setSharing] = useState(false)

  if (plan.isPending) return <div className="p-4" aria-busy="true" />
  const tree = plan.data
  if (!tree) {
    return (
      <div className="flex flex-col items-start gap-3 p-4">
        <h1 className="text-[28px] font-semibold tracking-[-0.025em]">Plan not found</h1>
        <Link to="/plans" className="text-brand inline-flex min-h-11 items-center font-medium underline underline-offset-4">
          Back to plans
        </Link>
      </div>
    )
  }

  const creatingDay = tree.days.find((d) => d.id === creating?.dayId)

  return (
    <div className="flex flex-col gap-4 px-4 pb-6">
      <StickyBar className="-mx-4">
        <div className="flex min-h-16 items-center justify-between py-2 pr-3 pl-2">
          <Link
            to="/plans"
            aria-label="Back to plans"
            className="text-muted-foreground hover:text-foreground inline-flex min-h-11 items-center gap-1 rounded-full pr-3 pl-2 text-base font-medium hover:bg-accent"
          >
            <ChevronLeft className="size-5" aria-hidden />
            Plans
          </Link>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={`${headerIconButton} w-auto gap-1.5 px-4 text-[15px] font-medium`}
              aria-haspopup="dialog"
              onClick={() => setSharing(true)}
            >
              <Share className="size-[18px]" aria-hidden />
              Share
            </button>
            <SettingsLink />
          </div>
        </div>
      </StickyBar>
      <InlineName
        label="Plan name"
        className="h-14 text-[26px] font-semibold tracking-[-0.025em] md:text-[26px]"
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
          className="surface flex flex-col gap-3 rounded-card p-4"
        >
          <div className="flex items-center gap-1.5">
            <DayDot color={dayColorOf(day)} className="mr-1 size-3" />
            <InlineName
              label="Day name"
              className="h-12 flex-1 text-lg font-semibold"
              value={day.name}
              onCommit={(name) =>
                saveDay.mutate({ id: day.id, plan_id: tree.id, name }, { onError: (e) => notifyError(e) })
              }
            />
            <DayColorButton
              day={day}
              open={colorDay === day.id}
              onToggle={() => setColorDay(colorDay === day.id ? null : day.id)}
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

          {colorDay === day.id && <DayColorPicker day={day} planId={tree.id} />}

          {day.items.length === 0 && (
            <p className="text-muted-foreground text-sm">No exercises on this day yet.</p>
          )}
          {linkDay === day.id ? (
            <SupersetPicker day={day} onDone={() => setLinkDay(null)} />
          ) : (
            <ul className="divide-border-strong/70 divide-y">
              {dayBlocks(day.items).map((block) =>
                block.kind === 'item' ? (
                  <PlanItemRow
                    key={block.item.id}
                    item={block.item}
                    isFirst={block.index === 0}
                    isLast={block.index === day.items.length - 1}
                  />
                ) : (
                  <li key={block.groupId} className="py-3">
                    <div
                      role="group"
                      aria-label={`Superset ${block.letter}`}
                      className="bg-background relative flex flex-col rounded-row py-1 pr-3 pl-4 [--field:var(--card)]"
                    >
                      <Rail />
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-base leading-none font-semibold">Superset {block.letter}</h3>
                        <Button
                          variant="ghost"
                          className="min-h-11"
                          aria-label={`Unlink superset ${block.letter}`}
                          disabled={setSuperset.isPending}
                          onClick={() =>
                            setSuperset.mutate(
                              { planDayId: day.id, groupId: block.groupId, itemIds: null },
                              { onError: supersetError },
                            )
                          }
                        >
                          <Unlink aria-hidden /> Unlink
                        </Button>
                      </div>
                      <ul className="divide-border-strong/70 divide-y">
                        {block.members.map((m) => (
                          <PlanItemRow
                            key={m.item.id}
                            item={m.item}
                            supersetLabel={m.label}
                            isFirst={m.index === 0}
                            isLast={m.index === day.items.length - 1}
                          />
                        ))}
                      </ul>
                    </div>
                  </li>
                ),
              )}
            </ul>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="min-h-11"
              aria-label={`Add exercise to ${day.name}`}
              onClick={() => setPickerDay(day.id)}
            >
              <Plus aria-hidden /> Add exercise
            </Button>
            {day.items.length >= 2 && linkDay !== day.id && (
              <Button
                variant="outline"
                className="min-h-11"
                aria-label={`Link superset in ${day.name}`}
                onClick={() => setLinkDay(day.id)}
              >
                <Link2 aria-hidden /> Link superset
              </Button>
            )}
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

      <ShareSheet tree={tree} open={sharing} onOpenChange={setSharing} />
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
