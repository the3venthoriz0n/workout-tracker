import { useEffect, useId, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { Screen } from '@/app/screen'
import { ForgotPasswordForm } from '@/components/forgot-password-form'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/auth/context'
import { toKind } from '@/auth/client'
import { AUTH_ERROR_TEXT } from '@/lib/auth-messages'

// The reset email links straight here with ?token=. The token is kept in memory only and
// removed from the address bar right away.
export function ResetPasswordScreen() {
  const a = useAuth()
  const id = useId()
  const navigate = useNavigate()
  const { pathname, search } = useLocation()
  const [token] = useState(() => new URLSearchParams(search).get('token') ?? '')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'expired'>(token ? 'idle' : 'expired')
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    if (search) navigate(pathname, { replace: true })
  }, [navigate, pathname, search])

  async function submit() {
    if (state === 'sending') return
    if (password.length < 10 || password.length > 128) return setProblem('Password must be 10 to 128 characters.')
    setProblem(null)
    setState('sending')
    try {
      await a.resetPassword(token, password)
      setPassword('')
      setState('done')
    } catch (e) {
      const kind = toKind(e)
      setState(kind === 'invalid_token' ? 'expired' : 'idle')
      if (kind !== 'invalid_token') setProblem(AUTH_ERROR_TEXT[kind])
    }
  }

  let body
  if (state === 'done') {
    body = (
      <>
        <p role="status">Password changed. Sign in with your new password.</p>
        <Button asChild className="min-h-11">
          <Link to="/settings">Sign in</Link>
        </Button>
      </>
    )
  } else if (state === 'expired') {
    body = (
      <>
        <p role="alert" className="text-destructive text-sm">
          {AUTH_ERROR_TEXT.invalid_token}
        </p>
        <ForgotPasswordForm />
      </>
    )
  } else {
    body = (
      <form
        className="flex flex-col gap-3"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-pw`}>New password</Label>
          <Input
            id={`${id}-pw`}
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p className="text-muted-foreground text-xs">10 to 128 characters.</p>
        </div>
        <Button type="button" variant="outline" className="min-h-11" onClick={() => setShow((v) => !v)}>
          {show ? 'Hide password' : 'Show password'}
        </Button>
        {problem && (
          <p role="alert" className="text-destructive text-sm">
            {problem}
          </p>
        )}
        <Button type="submit" className="min-h-11" disabled={state === 'sending'}>
          {state === 'sending' ? 'Changing...' : 'Change password'}
        </Button>
      </form>
    )
  }

  return (
    <div>
      <Screen title="Reset password" />
      <div className="flex flex-col gap-4 px-4 pb-6">
        <Card>
          <CardContent className="flex flex-col gap-3">{body}</CardContent>
        </Card>
      </div>
    </div>
  )
}
