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
import { NutritionAiCard } from '@/components/nutrition-ai-card'
import { PublicNameCard } from '@/components/public-name-card'
import { useSignedIn } from '@/auth/context'
import { notifyError } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { setRestTimerEnabled, useRestTimerEnabled } from '@/lib/rest-timer-pref'
import { setShowBothUnits, useShowBothUnits } from '@/lib/show-both-units-pref'
import { confirmBox, segmentedItem, segmentedTrack } from '@/lib/styles'

const UNITS: Units[] = ['lb', 'kg']

export function SettingsScreen() {
  const profile = useProfile().data
  const updateProfile = useUpdateProfile()
  const signedIn = useSignedIn()
  const restTimerOn = useRestTimerEnabled()
  const showBoth = useShowBothUnits()
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
        {/* Who you are first: the account, then the name it shows on shared plans */}
        <AccountCard />
        {signedIn && <PublicNameCard />}
        {signedIn && <NutritionAiCard />}

        {/* Two small preferences share one card: a label on the left, its control on the right */}
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Preferences</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="divide-border-strong/70 flex flex-col divide-y">
            <div className="flex flex-col gap-3 pb-4">
              <div className="flex min-h-11 items-center justify-between gap-3">
                <span id="units-label" className="text-sm font-medium">
                  Units
                </span>
                <div role="radiogroup" aria-labelledby="units-label" aria-label="Units" className={cn(segmentedTrack, 'w-36 shrink-0')}>
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
                    <Button className="min-h-11" onClick={confirmUnits} disabled={updateProfile.isPending}>
                      Convert to {pendingUnits}
                    </Button>
                    <Button
                      variant="outline"
                      className="min-h-11"
                      onClick={() => {
                        setPendingUnits(null)
                        setUnitsError(null)
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <label className="flex min-h-11 items-center justify-between gap-3 py-4">
              <span className="flex min-w-0 flex-col text-sm">
                <span className="font-medium">Show both units</span>
                <span className="text-muted-foreground">Add the other unit next to each weight. Saved on this device only.</span>
              </span>
              <Switch checked={showBoth} aria-label="Show both units" onCheckedChange={setShowBothUnits} />
            </label>

            <label className="flex min-h-11 items-center justify-between gap-3 pt-4">
              <span className="flex min-w-0 flex-col text-sm">
                <span className="font-medium">Rest timer</span>
                <span className="text-muted-foreground">After each set. Saved on this device only.</span>
              </span>
              <Switch checked={restTimerOn} aria-label="Show a rest timer after each set" onCheckedChange={setRestTimerEnabled} />
            </label>
          </CardContent>
        </Card>

        {/* Guests export from here; signed in, the data card sits directly above Delete account */}
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
