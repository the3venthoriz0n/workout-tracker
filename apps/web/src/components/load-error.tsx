import { Button } from '@/components/ui/button'

/** Shown when a list or screen failed to load, so a failed query never looks like an endless skeleton or an empty list. */
export function LoadError({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3">
      <p className="text-muted-foreground">Couldn't load {what}. Nothing was changed.</p>
      <Button variant="outline" className="min-h-11" onClick={onRetry}>
        Try again
      </Button>
    </div>
  )
}
