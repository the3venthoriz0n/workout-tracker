import { NotFoundError, OfflineError, type PublicPlanDetail, type SharedSnapshot } from '@workout/shared'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowBigUp, ChevronLeft } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { SettingsLink, StickyBar } from '@/app/screen'
import { useSignedIn } from '@/auth/context'
import { AngleChip, DayDot, SupersetLabel } from '@/components/plan-bits'
import { Button } from '@/components/ui/button'
import { SkeletonRows } from '@/components/ui/skeleton'
import { GONE_TEXT, OFFLINE_TEXT, adoptErrorText, compactCount } from '@/lib/community'
import { dayColorOf } from '@/lib/day-colors'
import { formatDate, formatWeight, pluralize } from '@/lib/format'
import { cn } from '@/lib/utils'
import { keys, useAdoptSharedPlan, useCommunityPlan, useHasVoted } from '@/repo/hooks'
import { useRepo } from '@/repo/provider'
import { Counts, LevelChip } from './community'

type SnapItem = SharedSnapshot['days'][number]['items'][number]

/** "5 × 5+ · 135 lb" (the + marks an AMRAP last set; no weight for bodyweight). */
const targets = (i: SnapItem, units: string) =>
  `${i.sets} × ${i.reps}${i.amrap_last ? '+' : ''}${i.weight > 0 ? ` · ${formatWeight(i.weight)} ${units}` : ''}`

/** Read-only preview of the snapshot: plain text only. */
function Preview({ snapshot }: { snapshot: SharedSnapshot }) {
  return (
    <div className="flex flex-col gap-3">
      {snapshot.days.map((day, di) => {
        const seen = new Map<string, number>()
        return (
          <section key={di} aria-label={day.name} className="surface flex flex-col gap-1 rounded-card p-4">
            <h3 className="flex items-center gap-2.5 text-[17px] font-semibold break-words">
              <DayDot color={dayColorOf({ color: day.color, position: di })} />
              {day.name}
            </h3>
            <ul className="divide-border-strong/70 divide-y">
              {day.items.map((item, ii) => {
                let label: string | null = null
                if (item.superset) {
                  const n = (seen.get(item.superset) ?? 0) + 1
                  seen.set(item.superset, n)
                  label = `${item.superset}${n}`
                }
                return (
                  <li key={ii} className="flex items-start gap-3 py-3">
                    {label && <SupersetLabel label={label} className="mt-0.5" />}
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-[15px] font-medium break-words">
                        <span>{item.exercise}</span>
                        <AngleChip angle={item.angle} />
                      </span>
                      <span className="text-muted-foreground text-sm tabular-nums">{targets(item, snapshot.units)}</span>
                      {item.gear.length > 0 && (
                        <span className="text-muted-foreground text-sm break-words">{item.gear.join(', ')}</span>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

/** Signed in: toggles with an optimistic count; a failure puts the old state back. */
function VoteButton({ detail }: { detail: PublicPlanDetail }) {
  const repo = useRepo()
  const queryClient = useQueryClient()
  const id = detail.listing.id
  const voted = useHasVoted(id, true)
  const [local, setLocal] = useState<{ voted: boolean; upvotes: number } | null>(null)
  const busy = useRef(false)
  const state = local ?? { voted: voted.data ?? false, upvotes: detail.listing.upvotes }

  async function toggle() {
    if (busy.current || voted.isPending) return
    busy.current = true
    const before = state
    const next = !before.voted
    setLocal({ voted: next, upvotes: Math.max(0, before.upvotes + (next ? 1 : -1)) })
    try {
      const { upvotes } = await repo.setVote(id, next)
      setLocal({ voted: next, upvotes })
      queryClient.setQueryData(keys.voted(id), next)
    } catch (err) {
      setLocal(before)
      toast.error(err instanceof OfflineError ? OFFLINE_TEXT : "Couldn't save your vote. Try again.")
    } finally {
      busy.current = false
    }
  }

  return (
    <Button
      variant={state.voted ? 'default' : 'secondary'}
      className="min-h-11 gap-1.5 px-4 tabular-nums"
      aria-pressed={state.voted}
      aria-label={`Upvote, ${pluralize(state.upvotes, 'upvote')}`}
      disabled={voted.isPending}
      onClick={() => void toggle()}
    >
      <ArrowBigUp aria-hidden className={cn('size-5', state.voted && 'fill-current')} />
      <span>{compactCount(state.upvotes)}</span>
    </Button>
  )
}

function UseButton({ detail }: { detail: PublicPlanDetail }) {
  const signedIn = useSignedIn()
  const adopt = useAdoptSharedPlan()
  const navigate = useNavigate()
  const busy = useRef(false)

  async function use() {
    if (busy.current) return
    busy.current = true
    const { listing, version, snapshot } = detail
    try {
      // Signed in, the server loads the snapshot itself; a guest copies the one shown here.
      const { plan_id } = await adopt.mutateAsync(
        signedIn
          ? { shared_plan_id: listing.id, version }
          : { shared_plan_id: listing.id, version, snapshot, title: listing.title, author: listing.author },
      )
      toast.success('Added to your plans')
      void navigate(`/plans/${plan_id}`)
    } catch (err) {
      console.error(err)
      toast.error(adoptErrorText(err))
      busy.current = false
    }
  }

  return (
    <Button size="big" className="w-full" disabled={adopt.isPending} onClick={() => void use()}>
      {adopt.isPending ? 'Adding...' : 'Use this plan'}
    </Button>
  )
}

export function CommunityPlanScreen() {
  const { id = '' } = useParams()
  const signedIn = useSignedIn()
  const plan = useCommunityPlan(id)

  const header = (
    <StickyBar className="-mx-4">
      <div className="flex min-h-16 items-center justify-between py-2 pr-3 pl-2">
        <Link
          to="/plans/community"
          aria-label="Back to community"
          className="text-muted-foreground hover:text-foreground inline-flex min-h-11 items-center gap-1 rounded-full pr-3 pl-2 text-base font-medium hover:bg-accent"
        >
          <ChevronLeft className="size-5" aria-hidden />
          Community
        </Link>
        <SettingsLink />
      </div>
    </StickyBar>
  )

  if (plan.isPending) {
    return (
      <div className="flex flex-col gap-4 px-4 pb-6">
        {header}
        <SkeletonRows rows={4} />
      </div>
    )
  }
  if (plan.isError) {
    const gone = plan.error instanceof NotFoundError
    return (
      <div className="flex flex-col gap-4 px-4 pb-6">
        {header}
        <div className="surface flex flex-col items-start gap-3 rounded-card p-5">
          <p className="text-[15px]">
            {gone ? GONE_TEXT : plan.error instanceof OfflineError ? OFFLINE_TEXT : "Couldn't load this plan."}
          </p>
          {!gone && (
            <Button variant="outline" className="min-h-11" onClick={() => void plan.refetch()}>
              Try again
            </Button>
          )}
        </div>
      </div>
    )
  }

  const d = plan.data
  const { listing } = d
  return (
    <div className="flex flex-col gap-5 px-4 pb-6">
      {header}
      <div className="flex flex-col gap-2">
        <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.025em] break-words">{listing.title}</h1>
        <p className="text-muted-foreground text-[15px] break-words">
          by {listing.author} · v{d.version} · {formatDate(listing.updated_at)}
        </p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-sm font-medium">{pluralize(listing.day_count, 'day')}</span>
          <LevelChip level={listing.level} />
          <Counts downloads={listing.downloads} upvotes={signedIn ? undefined : listing.upvotes} />
        </div>
      </div>
      {listing.description && (
        <p className="text-[16px] leading-relaxed break-words whitespace-pre-line">{listing.description}</p>
      )}

      <div className="flex items-center gap-3">
        {signedIn ? (
          <VoteButton detail={d} />
        ) : (
          <Link
            to="/settings"
            className="bg-secondary text-secondary-foreground inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-sm font-medium"
          >
            <ArrowBigUp aria-hidden className="size-5" />
            Sign in to upvote
          </Link>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">What&apos;s inside</h2>
        <Preview snapshot={d.snapshot} />
      </div>

      <div className="bg-background sticky bottom-(--nav-space) z-20 -mx-4 px-4 py-3 after:absolute after:inset-x-0 after:top-full after:h-(--nav-space) after:bg-background md:bottom-0 md:after:hidden">
        <UseButton detail={d} />
        <p className="text-muted-foreground mt-2 text-center text-sm">
          You get your own copy. Changes you make never affect the original.
        </p>
      </div>
    </div>
  )
}
