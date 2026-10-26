import { useSearchParams } from 'react-router'
import { useState } from 'react'
import { Screen } from '@/app/screen'
import { AddButton } from '@/components/add-button'
import { ExerciseSheet } from '@/components/exercise-sheet'
import { GearSheet } from '@/components/gear-sheet'
import { LibraryExercises } from '@/components/library-exercises'
import { LibraryGear } from '@/components/library-gear'
import { segmentedItem, segmentedTrack } from '@/lib/styles'
import { cn } from '@/lib/utils'
import type { Exercise, Gear } from '@workout/shared'

type Editing = { kind: 'exercise'; item?: Exercise } | { kind: 'gear'; item?: Gear } | null

const SECTIONS = [
  { id: 'exercises', label: 'Exercises' },
  { id: 'gear', label: 'Gear' },
] as const

export function LibraryScreen() {
  const [params, setParams] = useSearchParams()
  const active = params.get('section') === 'gear' ? 'gear' : 'exercises'

  const [editing, setEditing] = useState<Editing>(null)

  return (
    <div>
      <Screen
        title="Library"
        action={
          <AddButton
            label={active === 'gear' ? 'Add gear' : 'Add exercise'}
            onClick={() => setEditing({ kind: active === 'gear' ? 'gear' : 'exercise' })}
          />
        }
      />
      <div role="tablist" aria-label="Library sections" className={cn(segmentedTrack, 'mx-4 mb-4')}>
        {SECTIONS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`library-tab-${id}`}
            aria-selected={active === id}
            aria-controls="library-panel"
            className={segmentedItem(active === id)}
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
      <div role="tabpanel" id="library-panel" tabIndex={-1} className="outline-none" aria-labelledby={`library-tab-${active}`}>
        {active === 'gear' ? (
          <LibraryGear onEdit={(item) => setEditing({ kind: 'gear', item })} />
        ) : (
          <LibraryExercises
            onEdit={(item) => setEditing({ kind: 'exercise', item })}
            onAdd={() => setEditing({ kind: 'exercise' })}
          />
        )}
      </div>
      <ExerciseSheet
        key={editing?.kind === 'exercise' ? (editing.item?.id ?? 'new') : 'none-ex'}
        exercise={editing?.kind === 'exercise' ? editing.item : undefined}
        open={editing?.kind === 'exercise'}
        onOpenChange={(open) => !open && setEditing(null)}
      />
      <GearSheet
        key={editing?.kind === 'gear' ? (editing.item?.id ?? 'new') : 'none-gear'}
        gear={editing?.kind === 'gear' ? editing.item : undefined}
        open={editing?.kind === 'gear'}
        onOpenChange={(open) => !open && setEditing(null)}
      />
    </div>
  )
}
