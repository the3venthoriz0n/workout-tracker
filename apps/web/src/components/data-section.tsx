import type { ExportData } from '@workout/shared'
import { useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/auth/context'
import { downloadExport } from '@/lib/download-export'
import { notifyError } from '@/lib/notify'
import { RESTORE_ERROR_TEXT, plural, readExportFile, summarize, type RestoreErrorKind } from '@/lib/restore'
import { confirmBox } from '@/lib/styles'
import { useRepo } from '@/repo/provider'

const CONFIRM_WORD = 'REPLACE'

/**
 * Settings: export everything as JSON, or restore from such a file (spec §3, §8). A restore
 * REPLACES the library and history (no merge): the file is checked and summarised first, then the
 * user types REPLACE (and, signed in, the password). Errors keep the form as typed.
 */
export function DataSection({ signedIn }: { signedIn: boolean }) {
  const a = useAuth()
  const repo = useRepo()
  const id = useId()
  const fileInput = useRef<HTMLInputElement>(null)
  const submitting = useRef(false)
  const [file, setFile] = useState<{ name: string; data: ExportData } | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<RestoreErrorKind | null>(null)
  const [reading, setReading] = useState(false)
  const ready = confirm === CONFIRM_WORD && (!signedIn || password.length > 0) && !a.busy
  const where = signedIn ? 'on this account' : 'on this device'

  async function exportData() {
    try {
      await downloadExport(repo)
    } catch (err) {
      notifyError(err, 'Export failed')
    }
  }

  function reset() {
    setFile(null)
    setPassword('')
    setConfirm('')
    setError(null)
  }

  async function choose(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0]
    e.target.value = '' // choosing the same file again still fires
    if (!picked) return
    reset()
    setReading(true)
    const res = await readExportFile(picked)
    setReading(false)
    if ('error' in res) setError(res.error)
    else setFile({ name: picked.name, data: res.data })
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    // A second submit while one runs (or while another account action runs) is ignored, not an error.
    if (!file || !ready || submitting.current) return
    submitting.current = true
    setError(null)
    try {
      const kind = await a.restoreData(file.data, { signedIn, password: signedIn ? password : undefined })
      if (kind) setError(kind)
      else reset()
    } finally {
      submitting.current = false
    }
  }

  const s = file ? summarize(file.data) : null

  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-sm">
        Download a copy of your plans, library and history as a JSON file, or restore one. Restoring replaces
        everything {where}.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" className="min-h-11" onClick={() => void exportData()}>
          Export my data
        </Button>
        <Button variant="outline" className="min-h-11" disabled={reading || a.busy} onClick={() => fileInput.current?.click()}>
          Restore from a file
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          aria-label="Restore file"
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => void choose(e)}
        />
      </div>
      {error && !file && (
        <p role="alert" className="text-destructive text-sm">
          {RESTORE_ERROR_TEXT[error]}
        </p>
      )}
      {file && s && (
        <form role="alertdialog" aria-label="Confirm restore" className={confirmBox} noValidate onSubmit={submit}>
          <section aria-label="Restore summary" className="flex flex-col gap-1">
            <p className="text-sm font-medium break-all">
              {file.name}
              {s.exportedAt && <span className="text-muted-foreground font-normal">, exported {s.exportedAt}</span>}
            </p>
            <p className="text-sm">
              {plural(s.plans, 'plan')}, {plural(s.exercises, 'exercise')}, {plural(s.workouts, 'workout')}, in {s.units}
            </p>
          </section>
          <p className="text-sm">
            This replaces everything in your library and history {where} with the file. It can&apos;t be undone, so
            export your current data first if you might want it back.
          </p>
          <Button type="button" variant="outline" className="min-h-11" onClick={() => void exportData()}>
            Export current data first
          </Button>
          {signedIn && (
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
          )}
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
          {signedIn && a.pendingChanges > 0 && (
            <p className="text-muted-foreground text-sm">
              {a.pendingChanges} {a.pendingChanges === 1 ? 'change' : 'changes'} on this device that haven&apos;t reached
              the server will be discarded too.
            </p>
          )}
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {RESTORE_ERROR_TEXT[error]}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="destructive" className="min-h-11" disabled={!ready}>
              {a.busy ? 'Replacing...' : 'Replace my data'}
            </Button>
            <Button type="button" variant="outline" className="min-h-11" onClick={reset}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
