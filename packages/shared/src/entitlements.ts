import type { Profile } from './schemas.js'

export const ENTITLEMENTS: Record<'free' | 'pro', { maxPlans: number; aiPlansPerDay: number; charts: boolean }> = {
  free: { maxPlans: Infinity, aiPlansPerDay: 0, charts: true },
  pro: { maxPlans: Infinity, aiPlansPerDay: 5, charts: true },
}

export function can(profile: Pick<Profile, 'plan'>, feature: 'charts' | 'ai_plan'): boolean {
  const e = ENTITLEMENTS[profile.plan]
  return feature === 'charts' ? e.charts : e.aiPlansPerDay > 0
}

export function limit(profile: Pick<Profile, 'plan'>, key: 'maxPlans' | 'aiPlansPerDay'): number {
  return ENTITLEMENTS[profile.plan][key]
}
