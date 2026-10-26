import type { SetLog } from '@workout/shared'
import { ChevronLeft, PencilIcon } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { Screen } from '@/app/screen'
import { HistorySetEditor } from '@/components/history-set-editor'
import { AngleChip, Rail, SupersetLabel } from '@/components/plan-bits'
import { listGroup } from '@/lib/styles'
import { sessionBlocks } from '@/lib/session-blocks'
import { useDayColors } from '@/lib/use-day-colors'
import { Button } from '@/components/ui/button'
import { SkeletonRows } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { formatDate, formatWeight } from '@/lib/format'
import { notifyError } from '@/lib/notify'
import { useProfile, useSession, useUpdateSessionNote, useUpdateSet } from '@/repo/hooks'

export function HistoryDetailScreen() {
  const { id = '' } = useParams()
  return <HistoryDetailBody key={id} id={id} />
}

function HistoryDetailBody({ id }: { id: string }) {
  const { data: session, isPending } = useSession(id)
  const { data: profile } = useProfile()
  const updateSet = useUpdateSet()
  const updateNote = useUpdateSessionNote()
  const dayColors = useDayColors()
  const [editMode, setEditMode] = useState(false)
  const [openSet, setOpenSet] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState<string | null>(null)

  function saveSet(setId: string, patch: Parameters<typeof updateSet.mutateAsync>[0]['patch']) {
    return updateSet.mutateAsync({ id: setId, patch }).then(
      () => true,
      (err: unknown) => {
        notifyError(err, "Couldn't save the change")
        return false
      },
    )
  }

  const back = (
    <Link
      to="/history"
      aria-label="Back to history"
      className="text-muted-foreground hover:text-foreground mt-[env(safe-area-inset-top)] ml-2 inline-flex min-h-11 items-center gap-1 rounded-full pr-3 pl-2 text-base font-medium hover:bg-accent"
    >
      <ChevronLeft className="size-5" aria-hidden />
      History
    </Link>
  )

  if (isPending || !profile) {
    return (
      <div>
        {back}
        <SkeletonRows className="px-4" />
      </div>
    )
  }
  if (!session) {
    return (
      <div>
        {back}
        <p className="px-4">Workout not found.</p>
      </div>
    )
  }

  // Only finished workouts are editable here; the Today screen handles the active one
  const editable = session.completed_at !== null
  const editing = editable && editMode

  function saveNote() {
    if (!session || noteDraft === null) return
    if (noteDraft === session.note) {
      setNoteDraft(null)
      return
    }
    updateNote.mutate(
      { id: session.id, note: noteDraft },
      {
        onError: (err) => notifyError(err, "Couldn't save the note"),
        onSettled: () => setNoteDraft(null),
      },
    )
  }

  const units = profile.units
  // label: the superset label (A1) when the line sits in a superset block
  const setLine = (s: SetLog, exerciseName: string, label?: string | null) => (
    <li key={s.id} className="px-4 py-1">
      <div className="flex min-h-11 items-center gap-2">
        <span className={s.done ? 'flex-1 tabular-nums' : 'text-muted-foreground flex-1 tabular-nums'}>
          {label && (
            <>
              <span className="font-semibold">{label}</span>{' '}
              <span className="text-muted-foreground">{exerciseName}</span>{' '}
            </>
          )}
          {s.set_no}. {s.actual_reps} × {formatWeight(s.weight)} {units}
          {!s.done && ' · skipped'}
          {s.done && s.amrap && (
            <>
              {' · '}
              <span className="font-semibold">
                {s.actual_reps > s.target_reps ? `AMRAP +${s.actual_reps - s.target_reps}` : 'AMRAP'}
              </span>
            </>
          )}
        </span>
        {editing && (
          <button
            type="button"
            aria-label={`Edit set ${s.set_no} of ${exerciseName}`}
            aria-expanded={openSet === s.id}
            className="text-muted-foreground hover:bg-accent hover:text-foreground flex min-h-11 min-w-11 items-center justify-center rounded-full aria-expanded:bg-accent"
            onClick={() => setOpenSet(openSet === s.id ? null : s.id)}
          >
            <PencilIcon className="size-4" />
          </button>
        )}
      </div>
      {s.note && <p className="text-muted-foreground pb-1 text-sm">{s.note}</p>}
      {editing && openSet === s.id && (
        <HistorySetEditor set={s} unit={units} onSave={(patch) => saveSet(s.id, patch)} />
      )}
    </li>
  )

  return (
    <div>
      {back}
      <Screen
        title={formatDate(session.completed_at ?? session.started_at)}
        note={`${session.plan_name} · ${session.day_name}`}
        noteAccent={dayColors.get(session.plan_day_id)}
        action={
          editable && (
            <Button
              variant={editMode ? 'default' : 'outline'}
              className="min-h-11"
              aria-pressed={editMode}
              onClick={() => {
                setEditMode((v) => !v)
                setOpenSet(null)
              }}
            >
              Edit workout
            </Button>
          )
        }
      />
      <div className="flex flex-col gap-6 px-4 pb-6">
        {editing && (
          <p className="text-muted-foreground text-sm">
            Editing a past workout doesn't change your plan targets or progression.
          </p>
        )}
        {sessionBlocks(session.exercises).map((block) =>
          block.kind === 'exercise' ? (
            <section key={block.exercise.plan_item_id}>
              <h2 className="text-xl leading-tight font-semibold tracking-[-0.015em]">
                {block.exercise.exercise_name}
                <AngleChip angle={block.exercise.sets[0]?.angle} />
              </h2>
              <ul className={`${listGroup} mt-2.5`}>
                {block.exercise.sets.map((s) => setLine(s, block.exercise.exercise_name))}
              </ul>
            </section>
          ) : (
            <section
              key={block.group}
              aria-label={`Superset ${block.letter}`}
              className="surface relative -mx-1 rounded-card p-3 pl-4"
            >
              <Rail />
              <h2 className="text-muted-foreground text-sm font-medium">Superset</h2>
              {block.members.map((ex) => (
                <p key={ex.plan_item_id} className="mt-2 flex items-center gap-2">
                  <SupersetLabel label={ex.sets[0]?.superset_label ?? ''} />
                  <span className="text-lg leading-tight font-semibold tracking-[-0.015em]">
                    {ex.exercise_name}
                    <AngleChip angle={ex.sets[0]?.angle} />
                  </span>
                </p>
              ))}
              <ul className="bg-background divide-border-strong/70 mt-3 divide-y overflow-hidden rounded-row">
                {block.sets.map(({ set, exercise }) => setLine(set, exercise.exercise_name, set.superset_label))}
              </ul>
            </section>
          ),
        )}
        {editing ? (
          <section className="flex flex-col gap-1.5">
            <label htmlFor="session-note" className="text-muted-foreground text-sm">
              Note
            </label>
            <Textarea
              id="session-note"
              value={noteDraft ?? session.note}
              onChange={(e) => setNoteDraft(e.target.value)}
              onBlur={saveNote}
            />
          </section>
        ) : (
          session.note && (
            <section>
              <h2 className="text-muted-foreground text-sm">Note</h2>
              <p>{session.note}</p>
            </section>
          )
        )}
      </div>
    </div>
  )
}
