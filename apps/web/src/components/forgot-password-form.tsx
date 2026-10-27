import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/auth/context'
import { toKind } from '@/auth/client'
import { AUTH_ERROR_TEXT, EMAIL_INVALID_TEXT, RESEND_SENT_TEXT, RESET_SENT_TEXT, isEmail } from '@/lib/auth-messages'

// Asks for an address and always ends on the same sentence, whether or not it has an account.
// kind 'reset' sends a password reset link; 'setup' sends a new set-up link (both go through
// request-password-reset; the server picks the mail by whether the address is confirmed).
export function EmailLinkForm({ kind, onBack }: { kind: 'reset' | 'setup'; onBack?: () => void }) {
  const a = useAuth()
  const id = useId()
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [problem, setProblem] = useState<string | null>(null)
  const label = kind === 'reset' ? 'Send reset link' : 'Send a new link'

  async function submit() {
    if (state === 'sending') return
    if (!isEmail(email)) return setProblem(EMAIL_INVALID_TEXT)
    setProblem(null)
    setState('sending')
    try {
      await (kind === 'reset' ? a.requestPasswordReset(email.trim()) : a.resendVerification(email.trim()))
      setState('sent')
    } catch (e) {
      setState('idle')
      setProblem(AUTH_ERROR_TEXT[toKind(e)])
    }
  }

  return (
    <form
      className="flex flex-col gap-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-email`}>Email</Label>
        <Input
          id={`${id}-email`}
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      {problem && (
        <p role="alert" className="text-destructive text-sm">
          {problem}
        </p>
      )}
      {state === 'sent' && (
        <p role="status" className="text-sm">
          {kind === 'reset' ? RESET_SENT_TEXT : RESEND_SENT_TEXT}
        </p>
      )}
      <Button type="submit" className="min-h-11" disabled={state === 'sending'}>
        {state === 'sending' ? 'Sending...' : label}
      </Button>
      {onBack && (
        <Button type="button" variant="outline" className="min-h-11" onClick={onBack}>
          Back to sign in
        </Button>
      )}
    </form>
  )
}

export const ForgotPasswordForm = (p: { onBack?: () => void }) => <EmailLinkForm kind="reset" {...p} />
