import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AUTH_ERROR_TEXT, validateCredentials } from '@/lib/auth-messages'
import type { AuthErrorKind } from '@/auth/client'

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
        const problem = validateCredentials(email, password)
        setInvalid(problem)
        if (!problem) onSubmit(email.trim(), password)
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-email`}>Email</Label>
        <Input
          id={`${id}-email`}
          type="email"
          autoComplete="email"
          inputMode="email"
          className="h-11"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-pw`}>Password</Label>
        <Input
          id={`${id}-pw`}
          type="password"
          autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
          className="h-11"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {mode === 'sign-up' && <p className="text-muted-foreground text-xs">10 to 128 characters.</p>}
      </div>
      {message && (
        <p role="alert" className="text-destructive text-sm">
          {message}
        </p>
      )}
      <Button type="submit" className="min-h-11" disabled={busy}>
        {busy ? busyLabel : label}
      </Button>
    </form>
  )
}
