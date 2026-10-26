import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/auth/context'
import { CredentialsForm } from './credentials-form'

// Shown instead of the app when the session ended or cannot be checked: never guest data.
export function SessionPrompt() {
  const a = useAuth()
  const expired = a.status === 'expired'
  const [confirming, setConfirming] = useState(false)
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
          {confirming ? (
            <div role="alertdialog" aria-label="Confirm guest mode" className="surface mt-3 flex flex-col gap-2 rounded-card p-4 text-sm">
              <p>
                {a.pendingChanges} unsent {a.pendingChanges === 1 ? 'change' : 'changes'} on this device will be lost.
              </p>
              <Button variant="destructive" className="min-h-11" disabled={a.busy} onClick={() => void a.signOut({ discardPending: true })}>
                Discard changes and use guest mode
              </Button>
              <Button variant="outline" className="min-h-11" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              className="mt-3 min-h-11 w-full"
              disabled={a.busy}
              onClick={() => (a.pendingChanges > 0 ? setConfirming(true) : void a.signOut())}
            >
              Use guest mode instead
            </Button>
          )}
        </div>
      ) : (
        <Button className="min-h-11" onClick={a.retrySession}>
          Retry
        </Button>
      )}
    </div>
  )
}
