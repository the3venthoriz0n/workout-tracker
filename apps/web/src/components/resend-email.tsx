import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/auth/context'
import { toKind } from '@/auth/client'
import { AUTH_ERROR_TEXT, RESEND_SENT_TEXT } from '@/lib/auth-messages'

export const RESEND_COOLDOWN_MS = 30_000

// "Resend email" for an address waiting to be set up (a new set-up link). The answer is the same for any address;
// the button stays disabled for 30 seconds after each use.
export function ResendEmail({ email }: { email: string }) {
  const a = useAuth()
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [cooling, setCooling] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  async function send() {
    if (state === 'sending' || cooling) return
    setState('sending')
    setMessage(null)
    try {
      await a.resendVerification(email)
      setState('sent')
      setMessage(RESEND_SENT_TEXT)
    } catch (e) {
      setState('error')
      setMessage(AUTH_ERROR_TEXT[toKind(e)])
    }
    setCooling(true)
    timer.current = setTimeout(() => setCooling(false), RESEND_COOLDOWN_MS)
  }

  return (
    <div className="flex flex-col gap-2">
      <Button variant="outline" className="min-h-11" disabled={state === 'sending' || cooling} onClick={() => void send()}>
        {state === 'sending' ? 'Sending...' : 'Resend email'}
      </Button>
      {message && (
        <p role={state === 'error' ? 'alert' : 'status'} className={state === 'error' ? 'text-destructive text-sm' : 'text-muted-foreground text-sm'}>
          {message}
        </p>
      )}
    </div>
  )
}
