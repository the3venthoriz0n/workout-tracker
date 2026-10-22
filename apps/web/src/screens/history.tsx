import { Link } from 'react-router'
import { Screen } from '@/app/screen'
import { formatDate, pluralize } from '@/lib/format'
import { useSession, useSessions } from '@/repo/hooks'

function SessionRow({ id, completedAt, plan, day }: { id: string; completedAt: string; plan: string; day: string }) {
  const { data } = useSession(id)
  const done = data?.exercises.reduce((n, e) => n + e.sets.filter((s) => s.done).length, 0)
  return (
    <li>
      <Link
        to={`/history/${id}`}
        className="bg-card hover:bg-accent flex min-h-11 flex-col gap-0.5 rounded-lg border p-3"
      >
        <span className="font-medium">{formatDate(completedAt)}</span>
        <span className="text-muted-foreground text-sm">
          {plan} · {day}
        </span>
        {done !== undefined && <span className="text-muted-foreground text-sm">{pluralize(done, 'set')} done</span>}
      </Link>
    </li>
  )
}

export function HistoryScreen() {
  const { data, isPending } = useSessions()
  return (
    <div>
      <Screen title="History" />
      <div className="px-4 pb-4">
        {isPending || !data ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : data.length === 0 ? (
          <p className="text-muted-foreground">No workouts yet. Finish one on the Today tab.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.map((s) => (
              <SessionRow
                key={s.id}
                id={s.id}
                completedAt={s.completed_at ?? s.started_at}
                plan={s.plan_name}
                day={s.day_name}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
