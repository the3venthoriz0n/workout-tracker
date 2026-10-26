import { OfflineError, type PublicListing } from '@workout/shared'
import { ArrowBigUp, Download, Search, SlidersHorizontal } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Screen } from '@/app/screen'
import { Chip, CommunityFiltersSheet, NO_FILTERS, filterCount, type CommunityFilters } from '@/components/community-filters'
import { PlansToggle } from '@/components/plans-toggle'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SkeletonRows } from '@/components/ui/skeleton'
import { LEVEL_NAMES, OFFLINE_TEXT, compactCount, useDebounced } from '@/lib/community'
import { pluralize } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useCommunityList } from '@/repo/hooks'

type Sort = 'top' | 'new' | 'used'
const SORTS: { value: Sort; label: string }[] = [
  { value: 'top', label: 'Top' },
  { value: 'new', label: 'New' },
  { value: 'used', label: 'Most used' },
]

/** Upvotes and downloads with readable labels (the icons are decorative). */
export function Counts({ upvotes, downloads, className }: { upvotes?: number; downloads: number; className?: string }) {
  return (
    <span className={cn('text-muted-foreground flex items-center gap-3 text-sm tabular-nums', className)}>
      {upvotes !== undefined && (
        <span className="inline-flex items-center gap-1" aria-label={pluralize(upvotes, 'upvote')}>
          <ArrowBigUp aria-hidden className="size-4" />
          {compactCount(upvotes)}
        </span>
      )}
      <span className="inline-flex items-center gap-1" aria-label={pluralize(downloads, 'download')}>
        <Download aria-hidden className="size-4" />
        {compactCount(downloads)}
      </span>
    </span>
  )
}

export function LevelChip({ level }: { level: PublicListing['level'] }) {
  if (!level) return null
  return (
    <span className="bg-secondary text-secondary-foreground inline-flex h-6 items-center rounded-full px-2.5 text-xs font-medium">
      {LEVEL_NAMES[level]}
    </span>
  )
}

function ListingCard({ l }: { l: PublicListing }) {
  return (
    <li>
      <Link
        to={`/plans/community/${l.id}`}
        className="surface hover:bg-accent flex flex-col gap-2 rounded-card p-4 transition-colors duration-150 motion-reduce:transition-none"
      >
        <span className="flex flex-col gap-0.5">
          <span className="text-[17px] leading-snug font-semibold break-words">{l.title}</span>
          <span className="text-muted-foreground text-sm break-words">by {l.author}</span>
        </span>
        {l.description && (
          <span className="text-muted-foreground line-clamp-2 text-sm break-words whitespace-pre-line">{l.description}</span>
        )}
        <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-sm font-medium">{pluralize(l.day_count, 'day')}</span>
          <LevelChip level={l.level} />
          <Counts upvotes={l.upvotes} downloads={l.downloads} className="ml-auto" />
        </span>
      </Link>
    </li>
  )
}

export function CommunityScreen() {
  const [text, setText] = useState('')
  const [sort, setSort] = useState<Sort>('top')
  const [filters, setFilters] = useState<CommunityFilters>(NO_FILTERS)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const q = useDebounced(text.trim(), 300)
  const list = useCommunityList({
    q: q || undefined,
    days: filters.days ?? undefined,
    level: filters.level ?? undefined,
    gear: filters.noGear ? 'none' : undefined,
    sort,
  })
  const items = list.data?.pages.flatMap((p) => p.items) ?? []
  const nFilters = filterCount(filters)
  const narrowed = nFilters > 0 || q !== ''

  return (
    <div>
      <Screen title="Plans" />
      <div className="flex flex-col gap-4 px-4 pb-6">
        <PlansToggle />
        <div className="flex gap-2">
          <label className="relative flex-1">
            <Search aria-hidden className="text-muted-foreground pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2" />
            <Input
              type="search"
              className="pl-11"
              aria-label="Search community plans"
              placeholder="Search plans or exercises"
              enterKeyHint="search"
              autoComplete="off"
              maxLength={100}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <Button
            variant="secondary"
            className="h-12 shrink-0 px-4"
            aria-label={nFilters ? `Filters, ${nFilters} on` : 'Filters'}
            onClick={() => setFiltersOpen(true)}
          >
            <SlidersHorizontal aria-hidden />
            {nFilters > 0 && (
              <span className="bg-primary text-primary-foreground inline-flex size-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums">
                {nFilters}
              </span>
            )}
          </Button>
        </div>
        <div role="radiogroup" aria-label="Sort" className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
          {SORTS.map((s) => (
            <Chip key={s.value} on={sort === s.value} onClick={() => setSort(s.value)}>
              {s.label}
            </Chip>
          ))}
        </div>

        {list.isPending && <SkeletonRows rows={4} className="[&>div]:h-28 [&>div]:rounded-card" />}
        {list.isError && items.length === 0 && (
          <div className="surface flex flex-col items-start gap-3 rounded-card p-4">
            <p className="text-sm">
              {list.error instanceof OfflineError ? OFFLINE_TEXT : "Couldn't load community plans."}
            </p>
            <Button variant="outline" className="min-h-11" onClick={() => void list.refetch()}>
              Try again
            </Button>
          </div>
        )}
        {list.isSuccess && items.length === 0 && (
          <div className="surface flex flex-col items-start gap-3 rounded-card p-5">
            {narrowed ? (
              <>
                <p className="text-[15px]">No plans match. Try fewer filters or another word.</p>
                <Button
                  variant="outline"
                  className="min-h-11"
                  onClick={() => {
                    setText('')
                    setFilters(NO_FILTERS)
                  }}
                >
                  Clear search and filters
                </Button>
              </>
            ) : (
              <>
                <p className="text-[15px]">Nothing shared yet. Publish one of your plans.</p>
                <Link
                  to="/plans"
                  className="bg-primary text-primary-foreground inline-flex min-h-11 items-center rounded-full px-5 text-[15px] font-medium"
                >
                  Go to My plans
                </Link>
              </>
            )}
          </div>
        )}

        {items.length > 0 && (
          <ul aria-label="Community plans" className="flex flex-col gap-3">
            {items.map((l) => (
              <ListingCard key={l.id} l={l} />
            ))}
          </ul>
        )}
        {list.hasNextPage && (
          <Button
            variant="outline"
            className="min-h-11 self-center px-6"
            disabled={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage().catch(() => undefined)}
          >
            {list.isFetchingNextPage ? 'Loading...' : 'Load more'}
          </Button>
        )}
        {list.isFetchNextPageError && (
          <p role="alert" className="text-destructive text-center text-sm">
            {list.error instanceof OfflineError ? OFFLINE_TEXT : "Couldn't load more. Try again."}
          </p>
        )}
      </div>
      <CommunityFiltersSheet open={filtersOpen} value={filters} onOpenChange={setFiltersOpen} onApply={setFilters} />
    </div>
  )
}
