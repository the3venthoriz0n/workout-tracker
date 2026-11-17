import { AiFailedError, AiLimitError, AiUnavailableError, OfflineError, newId } from '@workout/shared'
import type { NutrientKey, NutritionEntryInput } from '@workout/shared'
import { Loader2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { NutritionEntrySheet } from '@/components/nutrition-entry-sheet'
import { Input } from '@/components/ui/input'
import { pluralize } from '@/lib/format'
import { useParseMeal, useSaveNutritionEntry } from '@/repo/hooks'

type Message = { text: string; tone: 'error' | 'info' }

function messageFor(err: unknown): string {
  // The daily allowance and a provider's own rate limit look the same from here, so do not promise tomorrow
  if (err instanceof AiLimitError) return 'AI limit reached. Try again later.'
  if (err instanceof AiUnavailableError) return "AI isn't set up yet. Check your key in Settings."
  if (err instanceof AiFailedError) return "Couldn't read that. Try describing it differently."
  if (err instanceof OfflineError) return 'Needs a connection.'
  return "Couldn't add that. Try again."
}

/**
 * One box and one button: say what you ate, and the estimates land in the log for `date`. A parse
 * writes nothing by itself; the entries are saved here, each under a fresh id (so a retried save is
 * harmless). Add disables for the whole round trip, so a double tap costs one parse.
 */
export function NutritionAdd({ date, aiOn = true, tracked }: { date: string; aiOn?: boolean; tracked: NutrientKey[] }) {
  if (!aiOn) return <ManualAdd date={date} tracked={tracked} />
  return <AiAdd date={date} />
}

const blank = (date: string): NutritionEntryInput => ({
  date,
  source: 'manual',
  name: '',
  quantity: '',
  calories: null,
  protein_g: null,
  carbs_g: null,
  fat_g: null,
  fiber_g: null,
  sugar_g: null,
  sodium_mg: null,
})

/** AI is off: one button opens the entry sheet empty, and what is typed is saved as the lifter's own numbers. */
function ManualAdd({ date, tracked }: { date: string; tracked: NutrientKey[] }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button type="button" className="h-12" onClick={() => setOpen(true)}>
        Add food
      </Button>
      <NutritionEntrySheet entry={blank(date)} isNew tracked={tracked} open={open} onOpenChange={setOpen} />
    </>
  )
}

function AiAdd({ date }: { date: string }) {
  const parse = useParseMeal()
  const save = useSaveNutritionEntry()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<Message | null>(null)
  const [remaining, setRemaining] = useState<number | null>(null)
  const inFlight = useRef(false)
  // Estimates that were parsed but did not all save: a retry saves just these, under the same ids, with no new parse
  const unsaved = useRef<{ text: string; entries: NutritionEntryInput[] } | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const meal = text.trim()
    if (!meal || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setMessage(null)
    try {
      let entries: NutritionEntryInput[]
      if (unsaved.current?.text === meal) {
        entries = unsaved.current.entries
      } else {
        unsaved.current = null
        const { items, remaining_today } = await parse.mutateAsync(meal)
        setRemaining(remaining_today)
        if (items.length === 0) {
          setMessage({ text: 'Nothing found. Try describing the food.', tone: 'info' })
          return
        }
        entries = items.map((item) => ({ ...item, id: newId(), date, source: 'ai' as const }))
      }
      const results = await Promise.allSettled(entries.map((e) => save.mutateAsync(e)))
      const failed = entries.filter((_, i) => results[i]!.status === 'rejected')
      if (failed.length > 0) {
        unsaved.current = { text: meal, entries: failed }
        setMessage({ text: "Couldn't save the estimates. Try again.", tone: 'error' })
        return
      }
      unsaved.current = null
      setText('')
    } catch (err) {
      setMessage({ text: messageFor(err), tone: 'error' })
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Input
          className="min-w-0 flex-1"
          aria-label="What did you eat?"
          placeholder="e.g. 1 chicken burrito, 1 yogurt"
          enterKeyHint="done"
          autoComplete="off"
          maxLength={500}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <Button type="submit" className="h-12 min-w-20 px-5" disabled={busy || text.trim() === ''}>
          {busy ? <Loader2 aria-hidden className="size-5 animate-spin motion-reduce:animate-none" /> : 'Add'}
        </Button>
      </div>
      {busy && (
        <p role="status" className="text-muted-foreground text-sm">
          Estimating your meal…
        </p>
      )}
      {message && (
        <p role="alert" className={message.tone === 'error' ? 'text-destructive text-sm' : 'text-muted-foreground text-sm'}>
          {message.text}
        </p>
      )}
      {remaining !== null && !message && (
        <p role="status" className="text-muted-foreground text-sm">
          {pluralize(remaining, 'AI estimate')} left today
        </p>
      )}
    </form>
  )
}
