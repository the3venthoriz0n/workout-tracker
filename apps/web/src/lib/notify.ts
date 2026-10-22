import { toast } from 'sonner'

export function notifyError(err: unknown, message = "Couldn't save that change"): void {
  console.error(err)
  toast.error(message)
}
