import { registerExercises } from './exercises.js'
import { registerGear } from './gear.js'
import { registerMe } from './me.js'
import { registerPlans } from './plans.js'
import { registerProgression } from './progression.js'
import { registerSessions } from './sessions.js'
import { registerTransfer } from './transfer.js'
import type { RouteDeps, V1 } from './types.js'

export type { RouteDeps } from './types.js'

/** Mounts every /api/v1 resource on `v1` (already behind requireUser). */
export function registerRoutes(v1: V1, deps: RouteDeps) {
  registerMe(v1, deps)
  registerGear(v1, deps)
  registerExercises(v1, deps)
  registerPlans(v1, deps)
  registerProgression(v1, deps)
  registerSessions(v1, deps)
  registerTransfer(v1, deps)
}
