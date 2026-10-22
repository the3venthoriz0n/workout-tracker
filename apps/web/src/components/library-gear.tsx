import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { pluralize } from '@/lib/format'
import { notifyError } from '@/lib/notify'
import { useExercises, useGear, useSaveGear } from '@/repo/hooks'

export function LibraryGear() {
  const gear = useGear().data ?? []
  const exercises = useExercises().data ?? []
  const saveGear = useSaveGear()
  const [newGear, setNewGear] = useState('')

  const counts = new Map<string, number>()
  for (const ex of exercises) {
    if (!ex.active) continue
    for (const id of ex.required_gear_ids) counts.set(id, (counts.get(id) ?? 0) + 1)
  }

  function addGear(e: React.FormEvent) {
    e.preventDefault()
    const name = newGear.trim()
    if (!name) return
    saveGear.mutate(
      { name, owned: true },
      { onSuccess: () => setNewGear(''), onError: (err) => notifyError(err) },
    )
  }

  return (
    <div className="flex flex-col gap-3 px-4 pb-4">
      <p className="text-muted-foreground text-sm">
        Gear you own decides which exercises appear when you build a plan.
      </p>
      <ul className="flex flex-col gap-2">
        {gear.map((g) => (
          <li key={g.id} className="bg-card rounded-lg border px-3">
            <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
              <span className="flex flex-col">
                {g.name}
                <span className="text-muted-foreground text-xs">
                  {pluralize(counts.get(g.id) ?? 0, 'exercise')}
                </span>
              </span>
              <Switch
                checked={g.owned}
                aria-label={g.name}
                onCheckedChange={(owned) =>
                  saveGear.mutate(
                    { id: g.id, name: g.name, owned },
                    { onError: (err) => notifyError(err) },
                  )
                }
              />
            </label>
          </li>
        ))}
      </ul>
      <form onSubmit={addGear} className="flex gap-2">
        <Input
          className="min-h-11"
          aria-label="Custom gear name"
          placeholder="Custom gear"
          value={newGear}
          onChange={(e) => setNewGear(e.target.value)}
        />
        <Button type="submit" className="min-h-11" disabled={!newGear.trim()}>
          Add custom gear
        </Button>
      </form>
    </div>
  )
}
