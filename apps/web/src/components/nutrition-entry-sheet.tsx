import { NUTRIENTS, newId, nutritionEntryInputSchema } from '@workout/shared'
import type { NutrientKey, NutritionEntryInput } from '@workout/shared'
import { useState } from 'react'
import { NumberField } from '@/components/number-field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { notifyError } from '@/lib/notify'
import { responsiveSheet } from '@/lib/sheet-classes'
import { useSaveNutritionEntry } from '@/repo/hooks'

type Props = { entry: NutritionEntryInput; isNew?: boolean; tracked: NutrientKey[]; open: boolean; onOpenChange: (open: boolean) => void }

export function NutritionEntrySheet({ entry, isNew = false, tracked, open, onOpenChange }: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className={responsiveSheet}
        // Editing must not pop the keyboard: focus the sheet itself, not a field
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          ;(e.currentTarget as HTMLElement).focus({ preventScroll: true })
        }}
      >
        {open && <EntryForm entry={entry} isNew={isNew} tracked={tracked} onDone={() => onOpenChange(false)} />}
      </SheetContent>
    </Sheet>
  )
}

function EntryForm({ entry, isNew, tracked, onDone }: { entry: NutritionEntryInput; isNew: boolean; tracked: NutrientKey[]; onDone: () => void }) {
  const save = useSaveNutritionEntry()
  // A new entry keeps one id for the life of the form, so a retried save is harmless
  const [id] = useState(() => entry.id ?? newId())
  const [name, setName] = useState(entry.name)
  const [quantity, setQuantity] = useState(entry.quantity)
  const [values, setValues] = useState<Record<NutrientKey, number | null>>({
    calories: entry.calories,
    protein_g: entry.protein_g,
    carbs_g: entry.carbs_g,
    fat_g: entry.fat_g,
    fiber_g: entry.fiber_g,
    sugar_g: entry.sugar_g,
    sodium_mg: entry.sodium_mg,
  })
  const [error, setError] = useState<string | null>(null)
  // The tracked nutrients, plus any this entry already holds a value for
  const shown = NUTRIENTS.filter((n) => tracked.includes(n.key) || entry[n.key] !== null)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    // Saving an edit by hand makes it the lifter's own number: it stops being an estimate
    const parsed = nutritionEntryInputSchema.safeParse({ ...values, id, date: entry.date, name, quantity, source: 'manual' })
    if (!parsed.success) {
      setError('Check the name and the numbers.')
      return
    }
    setError(null)
    save.mutate(parsed.data, {
      onSuccess: onDone,
      onError: (err) => notifyError(err, "Couldn't save the entry"),
    })
  }

  return (
    <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
      <SheetHeader className="shrink-0 pr-14">
        <SheetTitle>{isNew ? 'Add food' : 'Edit entry'}</SheetTitle>
        <SheetDescription className="sr-only">Enter the name, amount and numbers of this entry.</SheetDescription>
      </SheetHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-5 pb-5">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="nutrition-name">Name</Label>
          <Input id="nutrition-name" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="nutrition-quantity">Quantity</Label>
          <Input id="nutrition-quantity" autoComplete="off" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          {shown.map((n) => (
            <NumberField
              key={n.key}
              label={`${n.label} (${n.unit})`}
              kind="weight"
              allowEmpty
              value={values[n.key]}
              onCommit={(v) => {
                setValues((cur) => ({ ...cur, [n.key]: v }))
              }}
            />
          ))}
        </div>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
      </div>
      <div className="bg-popover shrink-0 border-t px-5 py-4">
        <Button type="submit" size="big" className="w-full" disabled={save.isPending}>
          Save
        </Button>
      </div>
    </form>
  )
}
