import type { Hono } from 'hono'
import type { Auth } from '../auth.js'
import type { MealParser } from '../ai/meal-parser.js'
import type { AppEnv } from '../middleware.js'
import type { Service } from '../service/index.js'
import type { PasswordGate } from './account.js'

export type RouteDeps = {
  getService: (userId: string) => Service
  auth: Auth
  /** One password check (and one per-account attempt budget) for every route that asks for it. */
  passwordGate: PasswordGate
  /** The configured AI meal parser, or null when no key is set (parse then answers 503 ai_unavailable). */
  mealParser: MealParser | null
}
export type V1 = Hono<AppEnv>
