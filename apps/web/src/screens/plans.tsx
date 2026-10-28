import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import type { Plan } from '@workout/shared'
import { Link } from 'react-router'
import { Screen } from '@/app/screen'
import { PlansToggle } from '@/components/plans-toggle'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SkeletonRows } from '@/components/ui/skeleton'
import { notifyError } from '@/lib/notify'
import { listGroup } from '@/lib/styles'
import { cn } from '@/lib/utils'
import { useCommunityPlan, usePlans, useSavePlan } from '@/repo/hooks'

/**
 * "Based on X by Y · v1" for copies of community plans, plus "Update available" when the public
 * latest version is newer. The check is lazy, cached per listing and silent when it fails (offline,
 * unpublished): the line itself comes from the plan and is always shown.
 */
function SourceLine({ source }: { source: NonNullable<Plan['source']> }) {
  const latest = useCommunityPlan(source.shared_plan_id, { quiet: true })
  const newer = (latest.data?.listing.version ?? 0) > source.version
  return (
    <span className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-normal">
      <span className="min-w-0 break-words">
        Based on {source.title} by {source.author} · v{source.version}
      </span>
      {newer && (
        <span className="bg-brand/12 text-foreground inline-flex h-6 items-center rounded-full px-2.5 text-xs font-medium">
          Update available
        </span>
      )}
    </span>
  )
}

export function PlansScreen() {
  const plans = usePlans()
  const save = useSavePlan()
  const [name, setName] = useState('')
  const list = plans.data ?? []
  const ready = name.trim().length > 0

  function add(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    save.mutate(
      { name: trimmed },
      { onSuccess: () => setName(''), onError: (e) => notifyError(e) },
    )
  }

  return (
    <div>
      <Screen title="Plans" />
      <div className="flex flex-col gap-4 px-4 pb-6">
        <PlansToggle />
        <form onSubmit={add} className="flex gap-2">
          <Input
            className="flex-1"
            enterKeyHint="done"
            autoComplete="off"
            aria-label="New plan name"
            placeholder="New plan name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button
            type="submit"
            aria-disabled={!ready || save.isPending}
            className={cn(
              'h-12 px-5',
              (!ready || save.isPending) &&
                'bg-secondary text-muted-foreground hover:bg-secondary cursor-default',
            )}
          >
            Add plan
          </Button>
        </form>

        {plans.isPending && <SkeletonRows />}
        {plans.isSuccess && list.length === 0 && (
          <p className="text-muted-foreground text-sm">No plans yet. Name one above to start.</p>
        )}

        <ul className={cn(listGroup, list.length === 0 && 'hidden')}>
          {list.map((plan) => (
            <li key={plan.id} className="flex items-center gap-1 py-1.5 pr-3 pl-4">
              <Link
                to={`/plans/${plan.id}`}
                className="flex min-h-12 min-w-0 flex-1 items-center justify-between gap-2 py-2 text-[17px] font-semibold"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="break-words">{plan.name}</span>
                  {plan.source && <SourceLine source={plan.source} />}
                </span>
                <ChevronRight className="text-muted-foreground size-5 shrink-0" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
