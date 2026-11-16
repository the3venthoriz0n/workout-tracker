import { defaultRule } from '@workout/shared'
import { useState } from 'react'
import { NumberField } from '@/components/number-field'
import { RuleFields } from '@/components/rule-editor'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { notifyError } from '@/lib/notify'
import { useProfile, useUpdateProfile } from '@/repo/hooks'

function StepCard() {
  const profile = useProfile().data
  const updateProfile = useUpdateProfile()
  const [error, setError] = useState<string | null>(null)
  if (!profile) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>Progression step</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        <NumberField
          label="Progression step"
          kind="weight"
          suffix={profile.units}
          value={profile.weight_increment}
          onCommit={(v) => {
            if (v === null || v <= 0) {
              setError('Progression step must be greater than 0.')
              return false
            }
            setError(null)
            updateProfile.mutate({ weight_increment: v }, { onError: (err) => notifyError(err) })
          }}
        />
        <p className="text-muted-foreground text-sm">
          The smallest weight change you can load. Progress steps and deloads snap to it.
        </p>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function DefaultsCard() {
  const profile = useProfile().data
  const updateProfile = useUpdateProfile()
  if (!profile) return null
  const rule = profile.default_rule ?? defaultRule(profile.weight_increment)
  return (
    <Card>
      <CardHeader>
        <CardTitle>App default rule</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-muted-foreground text-sm">
          Used by every exercise without its own default. Changing it updates every plan item that
          inherits it, now and from the next workout on.
        </p>
        <RuleFields
          rule={rule}
          idPrefix="default-rule"
          showStepHint={false}
          onSave={async (next) => {
            await updateProfile.mutateAsync({ default_rule: next })
          }}
        />
      </CardContent>
    </Card>
  )
}

/** The two global progression settings, shown in Library: the step and the app default rule. A single exercise's rule is edited in that exercise. */
export function ProgressionSettings() {
  return (
    <div className="flex flex-col gap-4 px-4 pb-6">
      <StepCard />
      <DefaultsCard />
      <p className="text-muted-foreground text-sm">
        Each exercise can have its own rule: open it in Exercises and edit Progression. A single plan item can override
        it from its plan.
      </p>
    </div>
  )
}
