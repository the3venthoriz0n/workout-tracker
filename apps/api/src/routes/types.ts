import type { Hono } from 'hono'
import type { AppEnv } from '../middleware.js'
import type { Service } from '../service/index.js'

export type RouteDeps = { getService: (userId: string) => Service }
export type V1 = Hono<AppEnv>
