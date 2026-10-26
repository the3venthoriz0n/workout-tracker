import { useQueries, useQueryClient } from '@tanstack/react-query'
import { CheckIcon } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { OfflineError, type SetLog } from '@workout/shared'
import { toast } from 'sonner'
import { Screen } from '@/app/screen'
import { AngleChip, DayDot, Rail, SupersetLabel, nameWithAngle } from '@/components/plan-bits'
import { SetRow } from '@/components/set-row'
import { fieldClass } from '@/components/ui/input'
import { confirmPanel, listGroup } from '@/lib/styles'
import { dayColorOf } from '@/lib/day-colors'
import { sessionBlocks } from '@/lib/session-blocks'
import { useDayColors } from '@/lib/use-day-colors'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { SkeletonRows } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { formatWeight } from '@/lib/format'
import { notifyError } from '@/lib/notify'
import { isHttpUrl } from '@/lib/links'
import { useWakeLock } from '@/lib/wake-lock'
import { cn } from '@/lib/utils'
import {
  planQueryOptions,
  useActiveSession,
  useDiscardSession,
  useFinishSession,
  usePlans,
  useProfile,
  useStartSession,
  useUpdateSessionNote,
  useUpdateSet,
} from '@/repo/hooks'
import { useRepo } from '@/repo/provider'
import type { FinishSummary, SessionDetail } from '@/repo/types'
import { SessionInProgressError } from '@/repo/types'

const selectClass = cn(fieldClass, 'h-12')

// Primary action docked above the floating tab bar (thumb zone); at the page end on md+.
// The ::after fills the gap down to the screen edge so content never shows between bar and nav.
const actionBarClass =
  'bg-background sticky bottom-(--nav-space) z-20 -mx-4 px-4 py-3 after:absolute after:inset-x-0 after:top-full after:h-(--nav-space) after:bg-background md:bottom-0 md:after:hidden'

function summaryLine(row: FinishSummary[number], unit: string): string {
  const { exercise_name: name, before, after } = row
  const w = formatWeight
  const repsChanged = after.reps !== before.reps
  switch (row.outcome) {
    case 'success':
      if (after.weight !== before.weight)
        return `${name}: ${w(before.weight)} → ${w(after.weight)} ${unit} ✓${
          repsChanged ? ` · reps ${before.reps} → ${after.reps}` : ''
        }`
      if (after.reps !== before.reps) return `${name}: ${before.reps} → ${after.reps} reps ✓`
      return `${name}: done ✓`
    case 'miss':
      return `${name}: missed — stays at ${w(after.weight)} ${unit}`
    case 'deload':
      return `${name}: deload ${w(before.weight)} → ${w(after.weight)} ${unit}${
        repsChanged ? ` · reps reset to ${after.reps}` : ''
      }`
    default:
      return `${name}: skipped`
  }
}

function Picker() {
  const repo = useRepo()
  const plans = usePlans().data
  const start = useStartSession()
  const queryClient = useQueryClient()
  const trees = useQueries({
    queries: (plans ?? []).map((p) => planQueryOptions(repo, p.id)),
  })
  const [planId, setPlanId] = useState('')
  const [dayId, setDayId] = useState('')

  if (!plans || trees.some((t) => t.isPending)) {
    return <SkeletonRows className="px-4" rows={2} />
  }
  const eligible = trees.flatMap((t) => {
    const plan = t.data
    if (!plan) return []
    const days = plan.days.filter((d) => d.items.length > 0)
    return days.length > 0 ? [{ ...plan, days }] : []
  })
  if (eligible.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3 px-4">
        <p>No plans with exercises yet. Create a plan and add a day with exercises to start a workout.</p>
        <Button asChild size="big">
          <Link to="/plans">Go to plans</Link>
        </Button>
      </div>
    )
  }
  const plan = eligible.find((p) => p.id === planId) ?? eligible[0]!
  const day = plan.days.find((d) => d.id === dayId) ?? plan.days[0]!

  function onStart() {
    start.mutate(day.id, {
      onError: (err) => {
        if (err instanceof SessionInProgressError) {
          toast.error('A workout is already in progress')
          void queryClient.invalidateQueries()
        } else notifyError(err, "Couldn't start the workout")
      },
    })
  }

  return (
    <div className="flex flex-col gap-4 px-4">
      <label className="text-muted-foreground flex flex-col gap-2 text-sm font-medium">
        Plan
        <select
          className={selectClass}
          value={plan.id}
          onChange={(e) => {
            setPlanId(e.target.value)
            setDayId('')
          }}
        >
          {eligible.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-col gap-2">
        <span id="day-chooser-label" className="text-muted-foreground text-sm font-medium">
          Day
        </span>
        <div role="radiogroup" aria-labelledby="day-chooser-label" className={listGroup}>
          {plan.days.map((d) => (
            <label
              key={d.id}
              className="has-focus-visible:ring-ring flex min-h-14 cursor-pointer items-center gap-3 px-4 py-2 has-focus-visible:ring-2 has-focus-visible:ring-inset"
            >
              <input
                type="radio"
                name="day"
                className="peer sr-only"
                aria-label={d.name}
                checked={d.id === day.id}
                onChange={() => setDayId(d.id)}
              />
              <DayDot color={dayColorOf(d)} className="size-3" />
              <span className="flex min-w-0 flex-1 items-center text-[17px] leading-tight font-medium break-words">
                {d.name}
              </span>
              <span className="flex items-center" aria-hidden>
                <CheckIcon
                  strokeWidth={2.5}
                  className={cn('size-5', d.id === day.id ? 'text-brand' : 'text-transparent')}
                />
              </span>
            </label>
          ))}
        </div>
      </div>
      <div className={cn(actionBarClass, 'mt-2')}>
        <Button size="big" className="w-full" disabled={start.isPending} onClick={onStart}>
          Start workout
        </Button>
      </div>
    </div>
  )
}

function SessionNote({ session }: { session: SessionDetail }) {
  const [note, setNote] = useState(session.note)
  const update = useUpdateSessionNote()
  return (
    <Textarea
      aria-label="Session note"
      placeholder="Session note"
      value={note}
      onChange={(e) => setNote(e.target.value)}
      onBlur={() => {
        if (note !== session.note)
          update.mutate(
            { id: session.id, note },
            {
              onError: (err) => notifyError(err, "Couldn't save the note"),
            },
          )
      }}
    />
  )
}

type SessionExercise = SessionDetail['exercises'][number]

function ExerciseHeading({ ex }: { ex: SessionExercise }) {
  return (
    <h2 className="text-xl leading-tight font-semibold tracking-[-0.015em]">
      {ex.exercise_name}
      <AngleChip angle={ex.sets[0]?.angle} />
    </h2>
  )
}

function ExerciseExtras({ ex }: { ex: SessionExercise }) {
  return (
    <>
      {ex.video_url && isHttpUrl(ex.video_url) && (
        <a
          href={ex.video_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-brand inline-flex min-h-11 items-center self-start text-sm font-medium underline underline-offset-4"
        >
          Watch video
        </a>
      )}
      {ex.notes && <p className="text-muted-foreground text-sm">{ex.notes}</p>}
    </>
  )
}

// Finish summary rows follow session.exercises order (LocalRepo and the API both build them from
// it), so the angle snapshot comes from the same index; on any mismatch the angle is left out.
function withAngles(summary: FinishSummary, session: SessionDetail): FinishSummary {
  if (summary.length !== session.exercises.length) return summary
  return summary.map((row, i) => {
    const ex = session.exercises[i]!
    if (ex.exercise_name !== row.exercise_name) return row
    return { ...row, exercise_name: nameWithAngle(row.exercise_name, ex.sets[0]?.angle) }
  })
}

function ActiveSession({
  session,
  unit,
  onFinished,
}: {
  session: SessionDetail
  unit: string
  onFinished: (s: FinishSummary) => void
}) {
  const updateSet = useUpdateSet()
  const finish = useFinishSession()
  const discard = useDiscardSession()
  const dayColors = useDayColors()
  useWakeLock(true)
  const [confirm, setConfirm] = useState<'finish' | 'discard' | null>(null)
  const anyDone = session.exercises.some((e) => e.sets.some((s) => s.done))
  const started = new Date(session.started_at).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })

  function doFinish() {
    finish.mutateAsync(session.id).then((summary) => onFinished(withAngles(summary, session)), (err: unknown) => {
      if (err instanceof OfflineError) {
        console.error(err)
        toast.error('Reconnect to finish. Your sets are saved on this device.')
      } else notifyError(err, "Couldn't finish the workout")
    })
  }

  function save(id: string, patch: Parameters<typeof updateSet.mutateAsync>[0]['patch']) {
    return updateSet.mutateAsync({ id, patch }).then(
      () => true,
      (err) => {
        notifyError(err)
        return false
      },
    )
  }

  const setRow = (s: SetLog, member?: { label: string; name: string }) => (
    <SetRow
      key={s.id}
      set={s}
      unit={unit}
      member={member}
      onToggle={() => save(s.id, { done: !s.done })}
      onEdit={(patch) => save(s.id, patch)}
    />
  )

  return (
    <>
      <Screen
        title={`${session.plan_name} · ${session.day_name}`}
        note={`Started ${started}`}
        accent={dayColors.get(session.plan_day_id)}
      />
      <div className="flex flex-col gap-7 px-4">
        <SessionNote key={session.id} session={session} />
        {sessionBlocks(session.exercises).map((block) =>
          block.kind === 'exercise' ? (
            <section key={block.exercise.plan_item_id} className="flex flex-col gap-2.5">
              <ExerciseHeading ex={block.exercise} />
              <ExerciseExtras ex={block.exercise} />
              <ul className="flex flex-col gap-2">{block.exercise.sets.map((s) => setRow(s))}</ul>
            </section>
          ) : (
            <section
              key={block.group}
              aria-label={`Superset ${block.letter}`}
              className="surface relative -mx-2 flex flex-col gap-2.5 rounded-card p-2.5 pl-3.5"
            >
              <Rail />
              <p className="text-muted-foreground text-sm font-medium">Superset</p>
              {block.members.map((ex) => (
                <div key={ex.plan_item_id} className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <SupersetLabel label={ex.sets[0]?.superset_label ?? ''} />
                    <ExerciseHeading ex={ex} />
                  </div>
                  <ExerciseExtras ex={ex} />
                </div>
              ))}
              <ul className="flex flex-col gap-2">
                {block.sets.map(({ set, exercise }) =>
                  setRow(set, { label: set.superset_label ?? '', name: exercise.exercise_name }),
                )}
              </ul>
            </section>
          ),
        )}

        {confirm === 'discard' ? (
          <div className={confirmPanel}>
            <p>Discard this workout? All logged sets are deleted.</p>
            <div className="flex gap-2">
              <Button
                variant="destructive"
                className="min-h-11 flex-1"
                disabled={discard.isPending}
                onClick={() =>
                  discard.mutate(session.id, { onError: (err) => notifyError(err, "Couldn't discard the workout") })
                }
              >
                Yes, discard
              </Button>
              <Button variant="outline" className="min-h-11 flex-1" onClick={() => setConfirm(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : confirm === null ? (
          // Kept away from Finish so the destructive action is never next to the primary one
          <Button
            variant="ghost"
            className="text-destructive hover:text-destructive min-h-11 self-start"
            onClick={() => setConfirm('discard')}
          >
            Discard
          </Button>
        ) : null}

        {confirm !== 'discard' && (
          <div className={cn(actionBarClass, 'mt-4')}>
            {confirm === 'finish' ? (
              <div className="flex flex-col gap-2">
                <p>No sets marked done — finish anyway?</p>
                <div className="flex gap-2">
                  <Button size="big" className="flex-1" onClick={doFinish} disabled={finish.isPending}>
                    Finish anyway
                  </Button>
                  <Button variant="outline" className="min-h-14 flex-1" onClick={() => setConfirm(null)}>
                    Keep going
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                size="big"
                className="w-full"
                disabled={finish.isPending}
                onClick={() => (anyDone ? doFinish() : setConfirm('finish'))}
              >
                Finish workout
              </Button>
            )}
          </div>
        )}
      </div>
    </>
  )
}

export function TodayScreen() {
  const active = useActiveSession()
  const profile = useProfile().data
  const [summary, setSummary] = useState<FinishSummary | null>(null)
  const unit = profile?.units ?? 'lb'

  let body
  if (active.isPending || !profile) {
    body = (
      <>
        <Screen title="Today" />
        <SkeletonRows className="px-4" rows={3} />
      </>
    )
  } else if (active.data) {
    body = <ActiveSession session={active.data} unit={unit} onFinished={setSummary} />
  } else {
    body = (
      <>
        <Screen title="Today" note="Pick a day to start." />
        <Picker />
      </>
    )
  }

  return (
    <div>
      {body}
      <Sheet open={summary !== null} onOpenChange={(o) => !o && setSummary(null)}>
        <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Workout complete</SheetTitle>
            <SheetDescription>Progression for your next session.</SheetDescription>
          </SheetHeader>
          <ul className="flex flex-col gap-2 px-5">
            {summary?.map((row, i) => (
              <li key={i} className={cn('tabular-nums', row.outcome === 'success' && 'text-success font-semibold')}>
                {summaryLine(row, unit)}
              </li>
            ))}
          </ul>
          <SheetFooter>
            <Button size="big" onClick={() => setSummary(null)}>
              Done
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  )
}
