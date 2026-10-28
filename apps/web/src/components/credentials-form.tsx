import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AUTH_ERROR_TEXT, EMAIL_INVALID_TEXT, isEmail, validateCredentials } from '@/lib/auth-messages'
import type { AuthErrorKind } from '@/auth/client'

/**
 * Sign-in asks for email and password. Sign-up asks for the email only: the password is chosen
 * through the emailed set-up link, after the address is confirmed (`password` is then '').
 */
export function CredentialsForm({
  mode,
  label,
  busyLabel,
  busy,
  error,
  onSubmit,
}: {
  mode: 'sign-in' | 'sign-up'
  label: string
  busyLabel: string
  busy: boolean
  error: AuthErrorKind | null
  onSubmit(email: string, password: string): void
}) {
  const id = useId()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [invalid, setInvalid] = useState<string | null>(null)
  const message = invalid ?? (error ? AUTH_ERROR_TEXT[error] : null)

  return (
    <form
      className="flex flex-col gap-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        if (busy) return
        const problem = mode === 'sign-up' ? (isEmail(email) ? null : EMAIL_INVALID_TEXT) : validateCredentials(email, password)
        setInvalid(problem)
        if (!problem) onSubmit(email.trim(), mode === 'sign-up' ? '' : password)
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
      {mode === 'sign-in' ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-pw`}>Password</Label>
          <Input
            id={`${id}-pw`}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">We&apos;ll email you a link to confirm the address and choose your password.</p>
      )}
      {message && (
        <p role="alert" className="text-destructive text-sm">
          {message}
        </p>
      )}
      <Button type="submit" className="mt-1 min-h-11" disabled={busy}>
        {busy ? busyLabel : label}
      </Button>
    </form>
  )
}
