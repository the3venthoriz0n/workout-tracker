import type { Profile } from './schemas.js'

export const ENTITLEMENTS: Record<
  'free' | 'pro',
  { maxPlans: number; aiPlansPerDay: number; aiMealsPerDay: number; charts: boolean }
> = {
  free: { maxPlans: Infinity, aiPlansPerDay: 0, aiMealsPerDay: 30, charts: true },
  pro: { maxPlans: Infinity, aiPlansPerDay: 5, aiMealsPerDay: 100, charts: true },
}

export function can(profile: Pick<Profile, 'plan'>, feature: 'charts' | 'ai_plan' | 'ai_nutrition'): boolean {
  const e = ENTITLEMENTS[profile.plan]
  if (feature === 'charts') return e.charts
  return feature === 'ai_nutrition' ? e.aiMealsPerDay > 0 : e.aiPlansPerDay > 0
}

export function limit(profile: Pick<Profile, 'plan'>, key: 'maxPlans' | 'aiPlansPerDay' | 'aiMealsPerDay'): number {
  return ENTITLEMENTS[profile.plan][key]
}
