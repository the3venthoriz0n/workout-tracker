import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/auth/context'
import type { AuthErrorKind } from '@/auth/client'
import { AUTH_ERROR_TEXT } from '@/lib/auth-messages'
import { downloadExport } from '@/lib/download-export'
import { notifyError } from '@/lib/notify'
import { confirmBox } from '@/lib/styles'
import { useRepo } from '@/repo/provider'

const CONFIRM_WORD = 'DELETE'

/**
 * Settings (signed in only): export, then delete the account. Deletion needs the password and the
 * word DELETE; on success the AuthProvider forgets the account on this device and returns to guest.
 * Errors keep the form as typed.
 */
export function DeleteAccountCard() {
  const a = useAuth()
  const repo = useRepo()
  const id = useId()
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<AuthErrorKind | null>(null)
  const ready = password.length > 0 && confirm === CONFIRM_WORD && !a.busy

  async function exportData() {
    try {
      await downloadExport(repo)
    } catch (err) {
      notifyError(err, 'Export failed')
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!ready) return
    setError(null)
    const kind = await a.deleteAccount(password)
    if (kind) setError(kind)
  }

  function cancel() {
    setOpen(false)
    setPassword('')
    setConfirm('')
    setError(null)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Delete account</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm">
          Deleting your account removes your profile, email, library, plans, workout history, votes and public name
          from the server and signs you out everywhere. This can&apos;t be undone.
        </p>
        <p className="text-muted-foreground text-sm">
          Plans you shared in Community stay there, shown as &ldquo;Deleted user&rdquo;. Download your data first if you
          want a copy.
        </p>
        <Button variant="outline" className="min-h-11" onClick={() => void exportData()}>
          Export my data
        </Button>
        {open ? (
          <form role="alertdialog" aria-label="Confirm account deletion" className={confirmBox} noValidate onSubmit={submit}>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-pw`}>Password</Label>
              <Input
                id={`${id}-pw`}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={error === 'invalid_password'}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-confirm`}>Type {CONFIRM_WORD} to confirm</Label>
              <Input
                id={`${id}-confirm`}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            {a.pendingChanges > 0 && (
              <p className="text-muted-foreground text-sm">
                {a.pendingChanges} {a.pendingChanges === 1 ? 'change' : 'changes'} on this device that haven&apos;t reached
                the server will be discarded too.
              </p>
            )}
            {error && (
              <p role="alert" className="text-destructive text-sm">
                {AUTH_ERROR_TEXT[error]}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="destructive" className="min-h-11" disabled={!ready}>
                {a.busy ? 'Deleting...' : 'Delete my account'}
              </Button>
              <Button type="button" variant="outline" className="min-h-11" onClick={cancel}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button variant="destructive" className="min-h-11" onClick={() => setOpen(true)}>
            Delete account
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
