import { OfflineError } from '@workout/shared'
import { toast } from 'sonner'

export function notifyError(err: unknown, message = "Couldn't save that change"): void {
  console.error(err)
  // Only set edits are queued offline; everything else needs a connection, and the message says so.
  if (err instanceof OfflineError) toast.error("You're offline. Reconnect and try again.")
  else toast.error(message)
}
