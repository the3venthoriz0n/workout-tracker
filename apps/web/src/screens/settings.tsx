import type { Units } from '@workout/shared'
import { useState } from 'react'
import { toast } from 'sonner'
import { Screen } from '@/app/screen'
import { NumberField } from '@/components/number-field'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useProfile, useUpdateProfile } from '@/repo/hooks'
import { useRepo } from '@/repo/provider'
import { notifyError } from '@/lib/notify'
import { cn } from '@/lib/utils'

const UNITS: Units[] = ['lb', 'kg']

export function SettingsScreen() {
  const profile = useProfile().data
  const updateProfile = useUpdateProfile()
  const repo = useRepo()
  const [pendingUnits, setPendingUnits] = useState<Units | null>(null)
  const [unitsError, setUnitsError] = useState<string | null>(null)
  const [incrementError, setIncrementError] = useState<string | null>(null)

  function confirmUnits() {
    if (!pendingUnits) return
    updateProfile.mutate(
      { units: pendingUnits },
      {
        onSuccess: () => {
          toast.success(`Switched to ${pendingUnits}`)
          setPendingUnits(null)
          setUnitsError(null)
        },
        onError: (err) => {
          setUnitsError("Couldn't switch units. Nothing was changed.")
          notifyError(err, "Couldn't switch units")
        },
      },
    )
  }

  async function exportData() {
    try {
      const data = await repo.exportAll()
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      )
      const a = document.createElement('a')
      a.href = url
      a.download = `workout-tracker-export-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 0)
    } catch (err) {
      notifyError(err, 'Export failed')
    }
  }

  return (
    <div>
      <Screen title="Settings" />
      <div className="flex flex-col gap-4 px-4 pb-4">
        <Card>
          <CardHeader>
            <CardTitle>Units</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div role="radiogroup" aria-label="Units" className="flex gap-2">
              {UNITS.map((u) => (
                <Button
                  key={u}
                  type="button"
                  role="radio"
                  aria-checked={profile?.units === u}
                  variant={profile?.units === u ? 'default' : 'outline'}
                  className="min-h-11 flex-1"
                  onClick={() => u !== profile?.units && (setUnitsError(null), setPendingUnits(u))}
                >
                  {u}
                </Button>
              ))}
            </div>
            {pendingUnits && (
              <div role="alertdialog" aria-label="Confirm unit change" className="flex flex-col gap-2 rounded-lg border p-3">
                <p className="text-sm">
                  Switch to {pendingUnits}? All saved weights will be converted and the increment
                  reset to the default.
                </p>
                {unitsError && (
                  <p role="alert" className="text-destructive text-sm">
                    {unitsError}
                  </p>
                )}
                <div className="flex gap-2">
                  <Button
                    className="min-h-11"
                    onClick={confirmUnits}
                    disabled={updateProfile.isPending}
                  >
                    Convert to {pendingUnits}
                  </Button>
                  <Button variant="outline" className="min-h-11" onClick={() => {
                      setPendingUnits(null)
                      setUnitsError(null)
                    }}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
            {profile && (
              <div className="flex flex-col gap-1">
                <NumberField
                  label="Weight increment"
                  kind="weight"
                  suffix={profile.units}
                  value={profile.weight_increment}
                  onCommit={(v) => {
                    if (v === null || v <= 0) {
                      setIncrementError('Increment must be greater than 0.')
                      return false
                    }
                    setIncrementError(null)
                    updateProfile.mutate(
                      { weight_increment: v },
                      { onError: (err) => notifyError(err) },
                    )
                  }}
                />
                {incrementError && <p className="text-destructive text-sm">{incrementError}</p>}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Data</CardTitle>
          </CardHeader>
          <CardContent>
            <Button variant="outline" className="min-h-11" onClick={() => void exportData()}>
              Export data
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
          </CardHeader>
          <CardContent>
            <p className={cn('text-muted-foreground text-sm')}>Accounts and sync are coming soon.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
