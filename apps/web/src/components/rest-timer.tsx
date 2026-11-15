import { XIcon } from 'lucide-react'
import { useEffect, useState } from 'react'

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// Counts up from the moment the last set was marked done. Informational only (no alarm), so
// it never nags; dismiss it with the X. It restarts on the next set marked done.
export function RestTimer({ since, onDismiss }: { since: number; onDismiss: () => void }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [since])
  return (
    <div className="surface rounded-row mb-2 flex min-h-11 items-center gap-3 pl-4">
      <span className="text-muted-foreground text-sm font-medium">Rest</span>
      <span role="timer" aria-label="Rest time" className="flex-1 text-[22px] font-semibold tabular-nums">
        {mmss(now - since)}
      </span>
      <button
        type="button"
        aria-label="Dismiss rest timer"
        className="text-muted-foreground hover:text-foreground flex size-11 items-center justify-center"
        onClick={onDismiss}
      >
        <XIcon className="size-4" aria-hidden />
      </button>
    </div>
  )
}
