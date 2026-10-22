import { useSearchParams } from 'react-router'
import { Screen } from '@/app/screen'
import { LibraryExercises } from '@/components/library-exercises'
import { LibraryGear } from '@/components/library-gear'
import { cn } from '@/lib/utils'

const SECTIONS = [
  { id: 'exercises', label: 'Exercises' },
  { id: 'gear', label: 'Gear' },
] as const

export function LibraryScreen() {
  const [params, setParams] = useSearchParams()
  const active = params.get('section') === 'gear' ? 'gear' : 'exercises'

  return (
    <div>
      <Screen title="Library" />
      <div role="tablist" aria-label="Library sections" className="mx-4 mb-3 flex gap-1 rounded-lg border p-1">
        {SECTIONS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`library-tab-${id}`}
            aria-selected={active === id}
            aria-controls="library-panel"
            className={cn(
              'min-h-11 flex-1 rounded-md px-3 text-sm font-medium transition-colors',
              active === id
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent',
            )}
            onClick={() => {
              const next = new URLSearchParams(params)
              if (id === 'gear') next.set('section', 'gear')
              else next.delete('section')
              setParams(next, { replace: true })
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="library-panel" aria-labelledby={`library-tab-${active}`}>
        {active === 'gear' ? <LibraryGear /> : <LibraryExercises />}
      </div>
    </div>
  )
}
