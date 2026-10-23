import { PencilIcon } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { Screen } from '@/app/screen'
import { HistorySetEditor } from '@/components/history-set-editor'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { formatDate, formatWeight } from '@/lib/format'
import { notifyError } from '@/lib/notify'
import { useProfile, useSession, useUpdateSessionNote, useUpdateSet } from '@/repo/hooks'

export function HistoryDetailScreen() {
  const { id = '' } = useParams()
  const { data: session, isPending } = useSession(id)
  const { data: profile } = useProfile()
  const updateSet = useUpdateSet()
  const updateNote = useUpdateSessionNote()
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
    <Link to="/history" className="text-muted-foreground inline-flex min-h-11 items-center px-4 text-sm">
      ← History
    </Link>
  )

  if (isPending || !profile) {
    return (
      <div>
        {back}
        <p className="text-muted-foreground px-4">Loading…</p>
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

  return (
    <div>
      {back}
      <div className="flex items-start justify-between gap-2 pr-4">
        <Screen
          title={formatDate(session.completed_at ?? session.started_at)}
          note={`${session.plan_name} · ${session.day_name}`}
        />
        {editable && (
          <Button
            variant="outline"
            className="mt-4 min-h-11"
            aria-pressed={editMode}
            onClick={() => {
              setEditMode((v) => !v)
              setOpenSet(null)
            }}
          >
            {editMode ? 'Done editing' : 'Edit'}
          </Button>
        )}
      </div>
      <div className="flex flex-col gap-4 p-4 pt-0">
        {editing && (
          <p className="text-muted-foreground text-sm">
            Editing a past workout doesn't change your plan targets or progression.
          </p>
        )}
        {session.exercises.map((ex) => (
          <section key={ex.plan_item_id} className="bg-card rounded-lg border p-3">
            <h2 className="font-medium">{ex.exercise_name}</h2>
            <ul className="mt-2 flex flex-col gap-1">
              {ex.sets.map((s) => (
                <li key={s.id}>
                  <div className="flex items-center gap-1">
                    <span className={s.done ? 'flex-1' : 'text-muted-foreground flex-1 opacity-60'}>
                      {s.set_no}. {s.actual_reps} × {formatWeight(s.weight)} {profile.units}
                      {!s.done && ' · skipped'}
                    </span>
                    {editing && (
                      <button
                        type="button"
                        aria-label={`Edit set ${s.set_no} of ${ex.exercise_name}`}
                        aria-expanded={openSet === s.id}
                        className="text-muted-foreground hover:bg-accent flex min-h-11 min-w-11 items-center justify-center rounded-md"
                        onClick={() => setOpenSet(openSet === s.id ? null : s.id)}
                      >
                        <PencilIcon className="size-4" />
                      </button>
                    )}
                  </div>
                  {s.note && <p className="text-muted-foreground text-sm">{s.note}</p>}
                  {editing && openSet === s.id && (
                    <HistorySetEditor set={s} unit={profile.units} onSave={(patch) => saveSet(s.id, patch)} />
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
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
