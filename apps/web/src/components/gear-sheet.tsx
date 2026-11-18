import { gearSchema, type Gear } from '@workout/shared'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { NumberField } from '@/components/number-field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { notifyError } from '@/lib/notify'
import { responsiveSheet } from '@/lib/sheet-classes'
import { useProfile, useSaveGear } from '@/repo/hooks'

type Props = {
  gear?: Gear
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function GearSheet({ gear, open, onOpenChange }: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className={responsiveSheet}
        // Editing existing gear must not pop the keyboard; new gear still starts on its name
        onOpenAutoFocus={(e) => {
          if (!gear) return
          e.preventDefault()
          ;(e.currentTarget as HTMLElement).focus({ preventScroll: true }) // focus the sheet itself, not a field
        }}
      >
        {open && <GearForm gear={gear} onDone={() => onOpenChange(false)} />}
      </SheetContent>
    </Sheet>
  )
}

function GearForm({ gear, onDone }: { gear?: Gear; onDone: () => void }) {
  const save = useSaveGear()
  const [name, setName] = useState(gear?.name ?? '')
  const [owned, setOwned] = useState(gear?.owned ?? true)
  const [maxWeight, setMaxWeight] = useState<number | null>(gear?.max_weight ?? null)
  const units = useProfile().data?.units ?? 'lb'
  const [error, setError] = useState<string | null>(null)
  const submitted = useRef(false)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (submitted.current) return
    const parsed = gearSchema
      .pick({ name: true, owned: true })
      .safeParse({ name: name.trim(), owned })
    if (!parsed.success) {
      setError('Name is required.')
      return
    }
    setError(null)
    submitted.current = true
    save.mutate(
      { ...(gear ? { id: gear.id } : {}), ...parsed.data, max_weight: maxWeight },
      {
        onSuccess: () => {
          toast.success(gear ? 'Gear saved' : 'Gear added')
          onDone()
        },
        onError: (err) => {
          submitted.current = false
          notifyError(err, "Couldn't save the gear")
        },
      },
    )
  }

  return (
    <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
      <SheetHeader className="shrink-0 pr-14">
        <SheetTitle>{gear ? 'Edit gear' : 'Add gear'}</SheetTitle>
        <SheetDescription>Gear you own decides which exercises you can plan.</SheetDescription>
      </SheetHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-5 pb-5">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="gear-name">Name</Label>
          <Input
            id="gear-name"
            autoComplete="off"
            enterKeyHint="done"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={!!error}
          />
          {error && <p className="text-destructive text-sm">{error}</p>}
        </div>

        <label className="flex min-h-11 items-center justify-between gap-3 text-sm font-medium">
          I own this
          <Switch checked={owned} onCheckedChange={setOwned} aria-label="I own this" />
        </label>

        <div className="flex flex-col gap-1.5">
          <NumberField
            label={`Max weight (${units}), optional`}
            kind="weight"
            allowEmpty
            value={maxWeight}
            placeholder="No limit"
            onCommit={(v) => {
              if (v !== null && v <= 0) return false
              setMaxWeight(v)
            }}
          />
          <p className="text-muted-foreground text-sm">
            The heaviest this goes. Once an exercise that needs it reaches this weight, progression adds reps instead.
          </p>
        </div>
      </div>

      <div className="bg-popover shrink-0 border-t px-5 py-4">
        <Button type="submit" size="big" className="w-full" disabled={save.isPending}>
          Save
        </Button>
      </div>
    </form>
  )
}
