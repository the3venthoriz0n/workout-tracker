import { nutritionSettingsOf } from '@workout/shared'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Screen } from '@/app/screen'
import { useSignedIn } from '@/auth/context'
import { LoadError } from '@/components/load-error'
import { NutritionAdd } from '@/components/nutrition-add'
import { NutritionGoals } from '@/components/nutrition-goals'
import { NutritionLog } from '@/components/nutrition-log'
import { NutritionTotals } from '@/components/nutrition-totals'
import { Button } from '@/components/ui/button'
import { SkeletonRows } from '@/components/ui/skeleton'
import { canGoNext, canGoPrev, dateLabel, localDate, shiftDate } from '@/lib/nutrition-date'
import { segmentedItem, segmentedTrack } from '@/lib/styles'
import { cn } from '@/lib/utils'
import { useNutrition, useProfile } from '@/repo/hooks'

const SECTIONS = [
  { id: 'track', label: 'Track' },
  { id: 'goals', label: 'Goals' },
] as const

const settingsLink = 'text-brand inline-flex min-h-11 items-center font-medium underline underline-offset-4'

export function NutritionScreen() {
  const signedIn = useSignedIn()
  const [params, setParams] = useSearchParams()
  const active = params.get('section') === 'goals' ? 'goals' : 'track'

  return (
    <div>
      <Screen title="Nutrition" />
      <div className="flex flex-col gap-4 px-4 pb-6">
        {!signedIn ? (
          // The AI runs on the server, so food tracking needs an account
          <div className="surface flex flex-col items-start gap-1 rounded-card p-4">
            <p className="text-[17px] font-semibold">Create an account to track nutrition</p>
            <p className="text-muted-foreground text-sm">Say what you ate and it is estimated and logged for you. Accounts are free.</p>
            <Link to="/settings" className={settingsLink}>
              Go to Settings
            </Link>
          </div>
        ) : (
          <>
            <div role="tablist" aria-label="Nutrition sections" className={segmentedTrack}>
              {SECTIONS.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  id={`nutrition-tab-${id}`}
                  aria-selected={active === id}
                  aria-controls="nutrition-panel"
                  className={segmentedItem(active === id)}
                  onClick={() => {
                    const next = new URLSearchParams(params)
                    if (id === 'track') next.delete('section')
                    else next.set('section', id)
                    setParams(next, { replace: true })
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div
              role="tabpanel"
              id="nutrition-panel"
              tabIndex={-1}
              className={cn('flex flex-col gap-4 outline-none')}
              aria-labelledby={`nutrition-tab-${active}`}
            >
              {active === 'goals' ? <NutritionGoals /> : <Track />}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// The day being logged: its totals, the box to add food, and the log itself.
function Track() {
  const today = localDate()
  const [date, setDate] = useState(today)
  const profile = useProfile()
  const entries = useNutrition(date)
  const settings = profile.data ? nutritionSettingsOf(profile.data) : null

  return (
    <>
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="icon"
          className="min-h-11 min-w-11"
          aria-label="Previous day"
          disabled={!canGoPrev(date, today)}
          onClick={() => setDate(shiftDate(date, -1))}
        >
          <ChevronLeft aria-hidden />
        </Button>
        <h2 className="text-xl leading-tight font-semibold tracking-[-0.015em]">{dateLabel(date, today)}</h2>
        <Button
          variant="ghost"
          size="icon"
          className="min-h-11 min-w-11"
          aria-label="Next day"
          disabled={!canGoNext(date, today)}
          onClick={() => setDate(shiftDate(date, 1))}
        >
          <ChevronRight aria-hidden />
        </Button>
      </div>

      {profile.isError || entries.isError ? (
        <LoadError
          what={profile.isError ? 'your nutrition settings' : 'this day'}
          onRetry={() => {
            void profile.refetch()
            void entries.refetch()
          }}
        />
      ) : !settings || entries.isPending ? (
        <SkeletonRows rows={2} />
      ) : (
        <>
          <NutritionTotals entries={entries.data} settings={settings} />
          <NutritionAdd date={date} />
          <NutritionLog entries={entries.data} tracked={settings.tracked} />
        </>
      )}
    </>
  )
}
