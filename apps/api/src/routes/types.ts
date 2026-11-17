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
  /** Seals and opens users' own AI keys (BETTER_AUTH_SECRET). */
  aiKeySecret: string | null
  /** The fetch used with a user's own provider; defaults to one that refuses private addresses. */
  userKeyFetch?: typeof fetch
}
export type V1 = Hono<AppEnv>
