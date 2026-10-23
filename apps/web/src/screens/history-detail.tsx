import { Link, useParams } from 'react-router'
import { Screen } from '@/app/screen'
import { formatDate, formatWeight } from '@/lib/format'
import { useProfile, useSession } from '@/repo/hooks'

export function HistoryDetailScreen() {
  const { id = '' } = useParams()
  const { data: session, isPending } = useSession(id)
  const { data: profile } = useProfile()

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

  return (
    <div>
      {back}
      <Screen
        title={formatDate(session.completed_at ?? session.started_at)}
        note={`${session.plan_name} · ${session.day_name}`}
      />
      <div className="flex flex-col gap-4 p-4">
        {session.exercises.map((ex) => (
          <section key={ex.plan_item_id} className="bg-card rounded-lg border p-3">
            <h2 className="font-medium">{ex.exercise_name}</h2>
            <ul className="mt-2 flex flex-col gap-1">
              {ex.sets.map((s) => (
                <li key={s.id}>
                  <span className={s.done ? undefined : 'text-muted-foreground opacity-60'}>
                    {s.set_no}. {s.actual_reps} × {formatWeight(s.weight)} {profile.units}
                    {!s.done && ' · skipped'}
                  </span>
                  {s.note && <p className="text-muted-foreground text-sm">{s.note}</p>}
                </li>
              ))}
            </ul>
          </section>
        ))}
        {session.note && (
          <section>
            <h2 className="text-muted-foreground text-sm">Note</h2>
            <p>{session.note}</p>
          </section>
        )}
      </div>
    </div>
  )
}
