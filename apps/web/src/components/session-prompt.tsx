import { Button } from '@/components/ui/button'
import { useAuth } from '@/auth/context'
import { CredentialsForm } from './credentials-form'

// Shown instead of the app when the session ended or cannot be checked: never guest data.
export function SessionPrompt() {
  const a = useAuth()
  const expired = a.status === 'expired'
  return (
    <div className="bg-background text-foreground flex min-h-dvh flex-col items-center justify-center gap-4 p-6">
      <div role="alert" className="max-w-sm text-center text-sm">
        {expired
          ? "You've been signed out. Sign in again to keep using your account."
          : "Can't reach the server to check your sign-in. Your data is safe on your account."}
      </div>
      {expired ? (
        <div className="w-full max-w-sm">
          <CredentialsForm mode="sign-in" label="Sign in" busyLabel="Signing in..." busy={a.busy} error={a.error} onSubmit={(e, p) => void a.signIn(e, p)} />
          <Button variant="outline" className="mt-3 min-h-11 w-full" disabled={a.busy} onClick={() => void a.signOut()}>
            Use guest mode instead
          </Button>
        </div>
      ) : (
        <Button className="min-h-11" onClick={a.retrySession}>
          Retry
        </Button>
      )}
    </div>
  )
}
