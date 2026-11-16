import { defaultRule } from '@workout/shared'
import { RuleFields } from '@/components/rule-editor'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useProfile, useUpdateProfile } from '@/repo/hooks'

/**
 * The one global progression setting: the default rule. When it adds weight, its Add amount is also
 * the progression step (the smallest weight you can load: the set editor's - / + buttons and every
 * progression and deload round to it), so they are saved together and cannot disagree.
 */
function DefaultRuleCard() {
  const profile = useProfile().data
  const updateProfile = useUpdateProfile()
  if (!profile) return null
  const rule = profile.default_rule ?? defaultRule(profile.weight_increment)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Default progression</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-muted-foreground text-sm">
          Used by every exercise without its own rule. The weight it adds is your progression step.
        </p>
        <RuleFields
          rule={rule}
          idPrefix="default-rule"
          showStepHint={false}
          onSave={async (next) => {
            await updateProfile.mutateAsync({
              default_rule: next,
              ...(next.success_action === 'add_weight' ? { weight_increment: next.success_amount } : {}),
            })
          }}
        />
      </CardContent>
    </Card>
  )
}

/** Library, Progression: the default rule. A single exercise's rule is edited in that exercise. */
export function ProgressionSettings() {
  return (
    <div className="px-4 pb-6">
      <DefaultRuleCard />
    </div>
  )
}
