import type { Hono } from 'hono'
import type { Auth } from '../auth.js'
import type { AppEnv } from '../middleware.js'
import type { Service } from '../service/index.js'
import type { PasswordGate } from './account.js'

export type RouteDeps = {
  getService: (userId: string) => Service
  auth: Auth
  /** One password check (and one per-account attempt budget) for every route that asks for it. */
  passwordGate: PasswordGate
}
export type V1 = Hono<AppEnv>
