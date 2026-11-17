import { aiEnabledOf, nutritionSettingsOf, nutritionSettingsSchema } from '@workout/shared'
import { NutritionAiKey } from '@/components/nutrition-ai-key'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { notifyError } from '@/lib/notify'
import { useProfile, useUpdateProfile } from '@/repo/hooks'

/**
 * Settings: "Nutrition tracking", how the Nutrition tab estimates food (signed in only). The switch turns the AI off, so food is
 * entered by hand; with it on, an optional key of your own replaces ours. Goals stay on the Nutrition tab.
 */
export function NutritionAiCard() {
  const profile = useProfile()
  const update = useUpdateProfile()
  if (!profile.data) return null
  const settings = nutritionSettingsOf(profile.data)
  const on = aiEnabledOf(settings)

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Nutrition tracking</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="divide-border-strong/70 flex flex-col divide-y">
        <label className="flex min-h-11 items-center justify-between gap-3 py-2">
          <span className="flex flex-col">
            <span className="text-[17px] font-semibold">AI estimates</span>
            <span className="text-muted-foreground text-sm">{on ? 'Describe a meal and it is logged' : 'Off: you enter food by hand'}</span>
          </span>
          <Switch
            checked={on}
            aria-label="AI estimates"
            onCheckedChange={(next) =>
              update.mutate(
                { nutrition: nutritionSettingsSchema.parse({ ...settings, aiEnabled: next }) },
                { onError: (err) => notifyError(err, "Couldn't save that setting") },
              )
            }
          />
        </label>
        {on && <NutritionAiKey />}
      </CardContent>
    </Card>
  )
}
