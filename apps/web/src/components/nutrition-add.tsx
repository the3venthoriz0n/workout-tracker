import { AiFailedError, AiLimitError, AiUnavailableError, OfflineError, newId } from '@workout/shared'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { pluralize } from '@/lib/format'
import { useParseMeal, useSaveNutritionEntry } from '@/repo/hooks'

type Message = { text: string; tone: 'error' | 'info' }

function messageFor(err: unknown): string {
  if (err instanceof AiLimitError) return "You've used today's AI estimates. Try again tomorrow."
  if (err instanceof AiUnavailableError) return "AI isn't set up on this server yet."
  if (err instanceof AiFailedError) return "Couldn't read that. Try describing it differently."
  if (err instanceof OfflineError) return 'Needs a connection.'
  return "Couldn't add that. Try again."
}

/**
 * One box and one button: say what you ate, and the estimates land in the log for `date`. A parse
 * writes nothing by itself; the entries are saved here, each under a fresh id (so a retried save is
 * harmless). Add disables for the whole round trip, so a double tap costs one parse.
 */
export function NutritionAdd({ date }: { date: string }) {
  const parse = useParseMeal()
  const save = useSaveNutritionEntry()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<Message | null>(null)
  const [remaining, setRemaining] = useState<number | null>(null)
  const inFlight = useRef(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const meal = text.trim()
    if (!meal || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setMessage(null)
    try {
      const { items, remaining_today } = await parse.mutateAsync(meal)
      setRemaining(remaining_today)
      if (items.length === 0) {
        setMessage({ text: 'Nothing found. Try describing the food.', tone: 'info' })
        return
      }
      try {
        await Promise.all(items.map((item) => save.mutateAsync({ ...item, id: newId(), date, source: 'ai' })))
      } catch {
        setMessage({ text: "Couldn't save the estimates. Try again.", tone: 'error' })
        return
      }
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
        <Button type="submit" className="h-12 px-5" disabled={busy || text.trim() === ''}>
          Add
        </Button>
      </div>
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
