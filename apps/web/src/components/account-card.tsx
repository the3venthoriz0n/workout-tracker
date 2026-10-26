import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/auth/context'
import { downloadExport } from '@/lib/download-export'
import { AUTH_ERROR_TEXT } from '@/lib/auth-messages'
import { notifyError } from '@/lib/notify'
import { confirmBox, segmentedItem, segmentedTrack } from '@/lib/styles'
import { useRepo } from '@/repo/provider'
import { CredentialsForm } from './credentials-form'

export function AccountCard() {
  const a = useAuth()
  const repo = useRepo()
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in')
  const [confirmingSignOut, setConfirmingSignOut] = useState(false)

  const exportGuest = () => downloadExport(repo).catch((err) => notifyError(err, 'Export failed'))

  let body
  if (a.status === 'signed-in' && a.confirmingDiscard) {
    body = (
      <div role="alertdialog" aria-label="Discard guest data" className={confirmBox}>
        <p className="text-sm">
          This account already has data. Signing in will discard the guest data on this device and
          use the account&apos;s data instead. They can&apos;t be merged.
        </p>
        {a.error && (
          <p role="alert" className="text-destructive text-sm">
            {AUTH_ERROR_TEXT[a.error]}
          </p>
        )}
        <Button variant="outline" className="min-h-11" onClick={() => void exportGuest()}>
          Export guest data first
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button variant="destructive" className="min-h-11" disabled={a.busy} onClick={() => void a.confirmDiscard()}>
            Discard guest data and continue
          </Button>
          <Button variant="outline" className="min-h-11" disabled={a.busy} onClick={() => void a.cancelDiscard()}>
            Cancel
          </Button>
        </div>
      </div>
    )
  } else if (a.status === 'signed-in') {
    body = (
      <div className="flex flex-col gap-3">
        <p className="text-sm">
          Signed in as <strong className="break-all">{a.email}</strong>
        </p>
        {a.pendingUpload && (
          <p role="alert" className="text-destructive text-sm">
            Your account is ready, but your guest data hasn&apos;t been uploaded. It is untouched on
            this device. Retry the upload.
          </p>
        )}
        {a.error && (
          <p role="alert" className="text-destructive text-sm">
            {AUTH_ERROR_TEXT[a.error]}
          </p>
        )}
        {a.pendingUpload && (
          <Button className="min-h-11" disabled={a.busy} onClick={() => void a.retryUpload()}>
            {a.busy ? 'Uploading...' : 'Retry upload'}
          </Button>
        )}
        {confirmingSignOut ? (
          <div role="alertdialog" aria-label="Confirm sign out" className={confirmBox}>
            <p className="text-sm">
              {a.pendingUpload
                ? "Your guest data hasn't been uploaded. Signing out deletes it from this device."
                : 'Sign out? This device returns to an empty guest profile. Your data stays in your account.'}
            </p>
            {a.pendingChanges > 0 && (
              <p role="alert" className="text-destructive text-sm">
                You have {a.pendingChanges} {a.pendingChanges === 1 ? 'change' : 'changes'} that haven&apos;t reached the
                server yet. Signing out discards {a.pendingChanges === 1 ? 'it' : 'them'}.
              </p>
            )}
            {a.pendingUpload && (
              <Button variant="outline" className="min-h-11" onClick={() => void exportGuest()}>
                Export guest data first
              </Button>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="destructive"
                className="min-h-11"
                disabled={a.busy}
                onClick={() => void a.signOut({ discardPending: true }).then(() => setConfirmingSignOut(false))}
              >
                Confirm sign out
              </Button>
              <Button variant="outline" className="min-h-11" onClick={() => setConfirmingSignOut(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" className="min-h-11" disabled={a.busy} onClick={() => setConfirmingSignOut(true)}>
            Sign out
          </Button>
        )}
      </div>
    )
  } else {
    body = (
      <div className="flex flex-col gap-3">
        <p className="text-muted-foreground text-sm">
          You&apos;re using the app as a guest; data stays on this device. An account syncs it.
        </p>
        <div role="tablist" aria-label="Account action" className={segmentedTrack}>
          {(['sign-in', 'sign-up'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              className={segmentedItem(mode === m)}
              onClick={() => {
                setMode(m)
                a.dismissError()
              }}
            >
              {m === 'sign-in' ? 'Sign in' : 'Sign up'}
            </button>
          ))}
        </div>
        <CredentialsForm
          key={mode}
          mode={mode}
          label={mode === 'sign-in' ? 'Sign in' : 'Create account'}
          busyLabel={mode === 'sign-in' ? 'Signing in...' : 'Creating account...'}
          busy={a.busy}
          error={a.error}
          onSubmit={(e, p) => void (mode === 'sign-in' ? a.signIn(e, p) : a.signUp(e, p))}
        />
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Account</CardTitle>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  )
}
