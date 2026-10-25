import { Link } from 'react-router'
import { Screen } from '@/app/screen'
import { Button } from '@/components/ui/button'
import { SkeletonRows } from '@/components/ui/skeleton'
import { formatDate, pluralize } from '@/lib/format'
import { useSession, useSessions } from '@/repo/hooks'

function SessionRow({ id, completedAt, plan, day }: { id: string; completedAt: string; plan: string; day: string }) {
  const { data } = useSession(id)
  const done = data?.exercises.reduce((n, e) => n + e.sets.filter((s) => s.done).length, 0)
  return (
    <li>
      <Link
        to={`/history/${id}`}
        className="hover:bg-accent/60 flex min-h-14 flex-col gap-0.5 rounded-md px-1 py-3"
      >
        <span className="font-heading text-xl leading-tight font-bold">{formatDate(completedAt)}</span>
        <span className="text-muted-foreground text-sm">
          {plan} · {day}
        </span>
        {done !== undefined && (
          <span className="text-muted-foreground text-sm tabular-nums">{pluralize(done, 'set')} done</span>
        )}
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
          <SkeletonRows />
        ) : data.length === 0 ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-muted-foreground">No workouts yet. Finish one on the Today tab.</p>
            <Button asChild variant="outline" className="min-h-11">
              <Link to="/">Go to Today</Link>
            </Button>
          </div>
        ) : (
          <ul className="divide-y border-y">
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
