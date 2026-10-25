import { useQueries, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { OfflineError } from '@workout/shared'
import { toast } from 'sonner'
import { Screen } from '@/app/screen'
import { SetRow } from '@/components/set-row'
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

const selectClass = 'border-input bg-card min-h-12 w-full rounded-md border px-3 text-base'

// Primary action docked above the bottom tab bar (thumb zone); at the page end on md+.
const actionBarClass =
  'bg-background sticky bottom-[calc(57px+env(safe-area-inset-bottom))] z-20 -mx-4 border-t px-4 py-3 md:bottom-0'

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
      <label className="flex flex-col gap-1.5 text-sm font-medium">
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
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Day
        <select className={selectClass} value={day.id} onChange={(e) => setDayId(e.target.value)}>
          {plan.days.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
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
  useWakeLock(true)
  const [confirm, setConfirm] = useState<'finish' | 'discard' | null>(null)
  const anyDone = session.exercises.some((e) => e.sets.some((s) => s.done))
  const started = new Date(session.started_at).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })

  function doFinish() {
    finish.mutateAsync(session.id).then(onFinished, (err: unknown) => {
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

  return (
    <>
      <Screen title={`${session.plan_name} · ${session.day_name}`} note={`Started ${started}`} />
      <div className="flex flex-col gap-6 px-4">
        <SessionNote key={session.id} session={session} />
        {session.exercises.map((ex) => (
          <section key={ex.plan_item_id} className="flex flex-col gap-2">
            <h2 className="font-heading text-2xl leading-tight font-bold">{ex.exercise_name}</h2>
            {ex.video_url && isHttpUrl(ex.video_url) && (
              <a
                href={ex.video_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary inline-flex min-h-11 items-center text-sm underline"
              >
                Watch video
              </a>
            )}
            {ex.notes && <p className="text-muted-foreground text-sm">{ex.notes}</p>}
            <ul className="flex flex-col gap-2">
              {ex.sets.map((s) => (
                <SetRow
                  key={s.id}
                  set={s}
                  unit={unit}
                  onToggle={() => save(s.id, { done: !s.done })}
                  onEdit={(patch) => save(s.id, patch)}
                />
              ))}
            </ul>
          </section>
        ))}

        {confirm === 'discard' ? (
          <div className="flex flex-col gap-2 rounded-md border p-3">
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
          <ul className="flex flex-col gap-2 px-4">
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
