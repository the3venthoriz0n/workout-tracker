import { ChevronRight, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Screen } from '@/app/screen'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SkeletonRows } from '@/components/ui/skeleton'
import { notifyError } from '@/lib/notify'
import { listGroup } from '@/lib/styles'
import { cn } from '@/lib/utils'
import { useDeletePlan, usePlans, useSavePlan } from '@/repo/hooks'


export function PlansScreen() {
  const plans = usePlans()
  const save = useSavePlan()
  const remove = useDeletePlan()
  const [name, setName] = useState('')
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const list = plans.data ?? []

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
          <Button type="submit" className="h-12 px-5" disabled={save.isPending}>
            <Plus aria-hidden /> Add plan
          </Button>
        </form>

        {plans.isPending && <SkeletonRows />}
        {plans.isSuccess && list.length === 0 && (
          <p className="text-muted-foreground text-sm">No plans yet. Name one above to start.</p>
        )}

        <ul className={cn(listGroup, list.length === 0 && 'hidden')}>
          {list.map((plan) => (
            <li key={plan.id} className="flex items-center gap-1 py-1.5 pr-2 pl-4">
              <Link
                to={`/plans/${plan.id}`}
                className="flex min-h-12 min-w-0 flex-1 items-center justify-between gap-2 py-2 text-[17px] font-semibold"
              >
                <span className="min-w-0 break-words">{plan.name}</span>
                <ChevronRight className="text-muted-foreground size-5 shrink-0" aria-hidden />
              </Link>
              {confirmId === plan.id ? (
                <>
                  <Button
                    variant="destructive"
                    className="min-h-11"
                    aria-label={`Confirm delete ${plan.name}`}
                    onClick={() =>
                      remove.mutate(plan.id, {
                        onSuccess: () => setConfirmId(null),
                        onError: (e) => notifyError(e),
                      })
                    }
                  >
                    Confirm delete
                  </Button>
                  <Button variant="ghost" className="min-h-11" onClick={() => setConfirmId(null)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button
                  variant="ghost"
                  className="text-destructive hover:text-destructive min-h-11"
                  aria-label={`Delete ${plan.name}`}
                  onClick={() => setConfirmId(plan.id)}
                >
                  Delete
                </Button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
