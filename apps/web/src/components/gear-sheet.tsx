import { gearSchema, type Gear } from '@workout/shared'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { notifyError } from '@/lib/notify'
import { useSaveGear } from '@/repo/hooks'

type Props = {
  gear?: Gear
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function GearSheet({ gear, open, onOpenChange }: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto">
        {open && <GearForm gear={gear} onDone={() => onOpenChange(false)} />}
      </SheetContent>
    </Sheet>
  )
}

function GearForm({ gear, onDone }: { gear?: Gear; onDone: () => void }) {
  const save = useSaveGear()
  const [name, setName] = useState(gear?.name ?? '')
  const [owned, setOwned] = useState(gear?.owned ?? true)
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
      { ...(gear ? { id: gear.id } : {}), ...parsed.data },
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
    <form onSubmit={submit} noValidate className="flex flex-col gap-4 overflow-y-auto p-4">
      <SheetHeader className="p-0">
        <SheetTitle>{gear ? 'Edit gear' : 'Add gear'}</SheetTitle>
        <SheetDescription>Gear you own decides which exercises you can plan.</SheetDescription>
      </SheetHeader>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="gear-name">Name</Label>
        <Input
          id="gear-name"
          className="min-h-11"
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

      <SheetFooter className="p-0">
        <Button type="submit" className="min-h-11" disabled={save.isPending}>
          Save
        </Button>
      </SheetFooter>
    </form>
  )
}
