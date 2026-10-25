import { randomBytes } from 'node:crypto'
import { createApp } from '../src/app.js'
import { createAuth } from '../src/auth.js'
import { createService } from '../src/service/index.js'
import type { OriginEnv } from '../src/origins.js'
import { withTestDb, type TestDb } from './harness.js'

export const TEST_ORIGIN = 'https://app.example.com'
export const GOOD_PASSWORD = 'correct horse battery'

export type TestEnv = OriginEnv & {
  BETTER_AUTH_SECRET: string
  STATIC_DIR?: string
  SIGNUP_ALLOWLIST?: string[]
}

export function testEnv(over: Partial<TestEnv> = {}): TestEnv {
  const NODE_ENV = over.NODE_ENV ?? 'test'
  return {
    NODE_ENV,
    BETTER_AUTH_URL: NODE_ENV === 'production' ? TEST_ORIGIN : 'http://localhost:3000',
    BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-0000',
    TRUSTED_ORIGINS: [],
    ...over,
  }
}

export type Harness = Awaited<ReturnType<typeof setupApp>>

type ReqOpts = {
  method?: string
  body?: unknown
  rawBody?: string
  cookie?: string
  origin?: string | null
  contentType?: string | null
  ip?: string
}

/** App over an isolated test schema. Each harness gets its own client IP so the process-wide rate-limit store never leaks between tests. */
export async function setupApp(over: Partial<TestEnv> = {}) {
  const t: TestDb = await withTestDb()
  const env = testEnv(over)
  const auth = createAuth(t.db, env, { clientIpHeader: 'x-test-client-ip' })
  const app = createApp({ auth, env, getService: (userId) => createService(t.db, userId) })
  const origin = env.BETTER_AUTH_URL
  const ip = `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${randomBytes(1)[0]}`

  function request(path: string, o: ReqOpts = {}) {
    const method = o.method ?? 'GET'
    const headers: Record<string, string> = { 'x-test-client-ip': o.ip ?? ip }
    const hasBody = o.body !== undefined || o.rawBody !== undefined
    if (o.origin !== null && (o.origin !== undefined || method !== 'GET')) headers.origin = o.origin ?? origin
    if (o.contentType !== null && (o.contentType !== undefined || hasBody)) {
      headers['content-type'] = o.contentType ?? 'application/json'
    }
    if (o.cookie) headers.cookie = o.cookie
    return app.request(path, {
      method,
      headers,
      body: o.rawBody ?? (o.body !== undefined ? JSON.stringify(o.body) : undefined),
    })
  }

  async function signUp(email: string, password = GOOD_PASSWORD, o: ReqOpts = {}) {
    return request('/api/auth/sign-up/email', {
      method: 'POST',
      body: { email, password, name: 'Test User' },
      ...o,
    })
  }

  async function signIn(email: string, password: string, o: ReqOpts = {}) {
    return request('/api/auth/sign-in/email', { method: 'POST', body: { email, password }, ...o })
  }

  return { ...t, env, auth, app, origin, request, signUp, signIn }
}

/** "name=value" pairs of all Set-Cookie headers, joined for a Cookie request header. */
export function cookieJar(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0]!)
    .filter((c) => !/=$/.test(c))
    .join('; ')
}
