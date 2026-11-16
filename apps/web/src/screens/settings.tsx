import type { Units } from '@workout/shared'
import { useState } from 'react'
import { toast } from 'sonner'
import { Screen } from '@/app/screen'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useProfile, useUpdateProfile } from '@/repo/hooks'
import { AboutFooter } from '@/components/about-footer'
import { AccountCard } from '@/components/account-card'
import { DataSection } from '@/components/data-section'
import { DeleteAccountCard } from '@/components/delete-account-card'
import { PublicNameCard } from '@/components/public-name-card'
import { useSignedIn } from '@/auth/context'
import { notifyError } from '@/lib/notify'
import { setRestTimerEnabled, useRestTimerEnabled } from '@/lib/rest-timer-pref'
import { confirmBox, segmentedItem, segmentedTrack } from '@/lib/styles'

const UNITS: Units[] = ['lb', 'kg']

export function SettingsScreen() {
  const profile = useProfile().data
  const updateProfile = useUpdateProfile()
  const signedIn = useSignedIn()
  const restTimerOn = useRestTimerEnabled()
  const [pendingUnits, setPendingUnits] = useState<Units | null>(null)
  const [unitsError, setUnitsError] = useState<string | null>(null)

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

  return (
    <div>
      <Screen title="Settings" />
      <div className="flex flex-col gap-4 px-4 pb-6">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Units</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div role="radiogroup" aria-label="Units" className={segmentedTrack}>
              {UNITS.map((u) => (
                <button
                  key={u}
                  type="button"
                  role="radio"
                  aria-checked={profile?.units === u}
                  className={segmentedItem(profile?.units === u)}
                  onClick={() => u !== profile?.units && (setUnitsError(null), setPendingUnits(u))}
                >
                  {u}
                </button>
              ))}
            </div>
            {pendingUnits && (
              <div role="alertdialog" aria-label="Confirm unit change" className={confirmBox}>
                <p className="text-sm">
                  Switch to {pendingUnits}? All saved weights will be converted and the progression
                  step reset to the default.
                </p>
                {unitsError && (
                  <p role="alert" className="text-destructive text-sm">
                    {unitsError}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Rest timer</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <label className="flex min-h-11 items-center justify-between gap-3 text-sm font-medium">
              Show a rest timer after each set
              <Switch checked={restTimerOn} aria-label="Show a rest timer after each set" onCheckedChange={setRestTimerEnabled} />
            </label>
            <p className="text-muted-foreground text-sm">Off by default. Saved on this device only.</p>
          </CardContent>
        </Card>

        {!signedIn && (
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Data</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <DataSection signedIn={false} />
            </CardContent>
          </Card>
        )}

        <AccountCard />
        {signedIn && <PublicNameCard />}
        {/* Signed in, the data card sits directly above Delete account: the one place to export. */}
        {signedIn && (
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Your data</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <DataSection signedIn />
            </CardContent>
          </Card>
        )}
        {signedIn && <DeleteAccountCard />}
        <AboutFooter />
      </div>
    </div>
  )
}
