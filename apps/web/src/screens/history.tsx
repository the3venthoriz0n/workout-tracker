import type { DayColor } from '@workout/shared'
import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router'
import { Screen } from '@/app/screen'
import { DayDot } from '@/components/plan-bits'
import { listGroup } from '@/lib/styles'
import { useDayColors } from '@/lib/use-day-colors'
import { Button } from '@/components/ui/button'
import { SkeletonRows } from '@/components/ui/skeleton'
import { formatDate, pluralize } from '@/lib/format'
import { useSession, useSessions } from '@/repo/hooks'

function SessionRow({
  id,
  completedAt,
  plan,
  day,
  color,
}: {
  id: string
  completedAt: string
  plan: string
  day: string
  color: DayColor | undefined
}) {
  const { data } = useSession(id)
  const done = data?.exercises.reduce((n, e) => n + e.sets.filter((s) => s.done).length, 0)
  return (
    <li>
      <Link
        to={`/history/${id}`}
        className="hover:bg-[color-mix(in_oklch,var(--card),var(--foreground)_4%)] flex min-h-16 items-center gap-3 px-4 py-3"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-[17px] leading-tight font-semibold">{formatDate(completedAt)}</span>
          <span className="text-muted-foreground flex items-center gap-2 text-sm">
            <DayDot color={color} />
            <span className="min-w-0">
              {plan} · {day}
            </span>
          </span>
          {done !== undefined && (
            <span className="text-muted-foreground text-sm tabular-nums">{pluralize(done, 'set')} done</span>
          )}
        </span>
        <ChevronRight className="text-muted-foreground size-5 shrink-0" aria-hidden />
      </Link>
    </li>
  )
}

export function HistoryScreen() {
  const { data, isPending } = useSessions()
  const dayColors = useDayColors()
  return (
    <div>
      <Screen title="History" />
      <div className="px-4 pb-6">
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
          <ul className={listGroup}>
            {data.map((s) => (
              <SessionRow
                key={s.id}
                id={s.id}
                completedAt={s.completed_at ?? s.started_at}
                plan={s.plan_name}
                day={s.day_name}
                color={dayColors.get(s.plan_day_id)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
