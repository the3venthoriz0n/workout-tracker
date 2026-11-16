import { LoadError } from '@/components/load-error'
import { Globe, Plus } from 'lucide-react'
import { useState } from 'react'
import type { Plan } from '@workout/shared'
import { Link, useNavigate } from 'react-router'
import { Screen } from '@/app/screen'
import { AddButton } from '@/components/add-button'
import { PlansToggle } from '@/components/plans-toggle'
import { DeleteConfirm, RowActions, useRestoreFocus } from '@/components/row-actions'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { SkeletonRows } from '@/components/ui/skeleton'
import { notifyError } from '@/lib/notify'
import { listGroup } from '@/lib/styles'
import { cn } from '@/lib/utils'
import { ShareSheet } from '@/components/share-sheet'
import { useCommunityPlan, useDeletePlan, usePlan, usePlans, useSavePlan } from '@/repo/hooks'

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
        <span className="bg-secondary text-foreground inline-flex h-6 items-center rounded-full px-2.5 text-sm font-medium">
          Update available
        </span>
      )}
    </span>
  )
}

// The share sheet needs the whole plan, so it is loaded only once someone asks to share.
function PlanShare({ id, onClose }: { id: string; onClose: () => void }) {
  const tree = usePlan(id)
  if (!tree.data) return null
  return <ShareSheet tree={tree.data} open onOpenChange={(o) => !o && onClose()} />
}

// One plan: the name opens it; the pencil renames in place and the trash deletes after a confirm,
// so neither needs a trip into the plan.
function PlanRow({ plan }: { plan: Plan }) {
  const save = useSavePlan()
  const remove = useDeletePlan()
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(plan.name)
  const [confirming, setConfirming] = useState(false)
  const [sharing, setSharing] = useState(false)
  const trashRef = useRestoreFocus(confirming)
  const published = plan.published?.status === 'published' ? plan.published : null

  function commit() {
    const trimmed = name.trim()
    if (!trimmed || trimmed === plan.name) {
      setName(plan.name)
      setRenaming(false)
      return
    }
    save.mutate(
      { id: plan.id, name: trimmed },
      { onSuccess: () => setRenaming(false), onError: (e) => notifyError(e) },
    )
  }

  return (
    <li className="flex flex-col py-1.5 pr-1.5 pl-4">
      <div className="flex items-center gap-1">
        {renaming ? (
          <form
            className="flex min-w-0 flex-1 items-center gap-2 py-1"
            onSubmit={(e) => {
              e.preventDefault()
              commit()
            }}
          >
            <Input
              aria-label={`Name for ${plan.name}`}
              className="min-w-0 flex-1"
              autoFocus
              enterKeyHint="done"
              autoComplete="off"
              value={name}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setName(plan.name)
                  setRenaming(false)
                }
              }}
            />
            <Button type="submit" className="min-h-11" disabled={save.isPending}>
              Save
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="min-h-11"
              onClick={() => {
                setName(plan.name)
                setRenaming(false)
              }}
            >
              Cancel
            </Button>
          </form>
        ) : (
          <>
            <Link
              to={`/plans/${plan.id}`}
              className="flex min-h-12 min-w-0 flex-1 items-center py-2 text-[17px] font-semibold"
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="break-words">{plan.name}</span>
                {plan.source && <SourceLine source={plan.source} />}
              </span>
            </Link>
            {published && (
              <Link
                to={`/plans/community/${published.shared_plan_id}`}
                aria-label={`View ${plan.name} in Community`}
                className="text-muted-foreground hover:text-foreground hover:bg-accent flex size-11 shrink-0 items-center justify-center rounded-full"
              >
                <Globe className="size-5" aria-hidden />
              </Link>
            )}
            {!confirming && (
              <RowActions
                trashRef={trashRef}
                name={plan.name}
                onShare={() => setSharing(true)}
                onEdit={() => {
                  setName(plan.name)
                  setRenaming(true)
                }}
                onDelete={() => setConfirming(true)}
              />
            )}
          </>
        )}
      </div>
      {sharing && <PlanShare id={plan.id} onClose={() => setSharing(false)} />}
      {confirming && (
        <DeleteConfirm
          name={plan.name}
          subject="plan"
          status="ready"
          impact="Deletes this plan with its days and exercises. Past workouts keep their records."
          pending={remove.isPending}
          onConfirm={() => remove.mutate(plan.id, { onError: (e) => notifyError(e) })}
          onCancel={() => setConfirming(false)}
        />
      )}
    </li>
  )
}

export function PlansScreen() {
  const plans = usePlans()
  const save = useSavePlan()
  const navigate = useNavigate()
  const list = plans.data ?? []

  // Adding goes straight into the new plan, where its name is focused and ready to type over
  function add() {
    if (save.isPending) return
    save.mutate(
      { name: 'New plan' },
      {
        onSuccess: (plan) => navigate(`/plans/${plan.id}`, { state: { newPlan: true } }),
        onError: (e) => notifyError(e),
      },
    )
  }

  return (
    <div>
      <Screen title="Plans" action={<AddButton label="Add plan" onClick={add} />} />
      <div className="flex flex-col gap-4 px-4 pb-6">
        <PlansToggle />

        {plans.isError && <LoadError what="your plans" onRetry={() => void plans.refetch()} />}
        {plans.isPending && <SkeletonRows />}
        {plans.isSuccess && list.length === 0 && (
          <div className="flex flex-col items-start gap-3">
            <p className="text-muted-foreground text-sm">No plans yet. Add your first plan to get started.</p>
            <Button type="button" variant="outline" className="min-h-11" onClick={add}>
              <Plus aria-hidden /> Create plan
            </Button>
          </div>
        )}

        <ul className={cn(listGroup, list.length === 0 && 'hidden')}>
          {list.map((plan) => (
            <PlanRow key={plan.id} plan={plan} />
          ))}
        </ul>
      </div>
    </div>
  )
}
