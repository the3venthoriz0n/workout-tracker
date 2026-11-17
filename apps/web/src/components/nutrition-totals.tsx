import { NUTRIENTS, dayTotals } from '@workout/shared'
import type { NutritionEntry, NutritionSettings } from '@workout/shared'
import { cn } from '@/lib/utils'

/**
 * The day against its goals, for the nutrients being tracked. Numbers first: the total is the large
 * figure, the goal and what is left are said in words (never colour alone), and a thin bar is only a
 * second cue. An entry without a value for a nutrient is left out of that total and counted aloud.
 */
export function NutritionTotals({ entries, settings }: { entries: readonly NutritionEntry[]; settings: NutritionSettings }) {
  const totals = dayTotals(entries, settings)
  return (
    <section aria-label="Totals" className="surface rounded-card grid grid-cols-2 gap-x-4 gap-y-5 p-4">
      {NUTRIENTS.filter((n) => settings.tracked.includes(n.key)).map((n) => {
        const t = totals[n.key]
        const over = t.left !== null && t.left < 0
        const goalText = t.goalMin !== null && t.goal !== null ? `${t.goalMin}\u2013${t.goal}` : String(t.goal)
        const notCounted = t.counted < entries.length
        const parts = [
          t.goal === null ? `${n.label}: ${t.total} ${n.unit}` : `${n.label}: ${t.total} of ${goalText} ${n.unit}`,
          t.toMin !== null ? `${t.toMin} ${n.unit} to reach the minimum` : null,
          t.left === null ? null : `${Math.abs(t.left)} ${n.unit} ${over ? 'over' : 'left'}`,
          notCounted ? `${t.counted} of ${entries.length} entries counted` : null,
        ].filter(Boolean)
        return (
          <div key={n.key} role="group" aria-label={parts.join(', ')} className="flex min-w-0 flex-col gap-1">
            <div aria-hidden className="flex flex-col gap-1">
              <p className="text-muted-foreground text-sm font-medium">{n.label}</p>
              <p className="tabular-nums">
                <span className="text-[26px] leading-none font-semibold tracking-[-0.02em]">{t.total}</span>
                <span className="text-muted-foreground text-sm"> {t.goal === null ? n.unit : `/ ${goalText} ${n.unit}`}</span>
              </p>
              {t.goal !== null && (
                <div className="bg-muted h-1.5 overflow-hidden rounded-full">
                  <div
                    className={cn('h-full rounded-full', over ? 'bg-destructive' : 'bg-foreground')}
                    style={{ width: `${Math.min(100, (t.total / t.goal) * 100)}%` }}
                  />
                </div>
              )}
              {t.left !== null && (
                <p className={cn('text-sm tabular-nums', over ? 'text-destructive font-medium' : 'text-muted-foreground')}>
                  {Math.abs(t.left)} {n.unit} {over ? 'over' : 'left'}
                  {t.toMin !== null && ` \u00b7 ${t.toMin} ${n.unit} to minimum`}
                </p>
              )}
              {notCounted && (
                <p className="text-muted-foreground text-sm">
                  {t.counted} of {entries.length} entries counted
                </p>
              )}
            </div>
          </div>
        )
      })}
    </section>
  )
}
