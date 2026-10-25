import { randomUUID } from 'node:crypto'
import { createApiRepo } from '@workout/shared'
import { runRepoContract } from '@workout/shared/testing'
import { cookieJar, setupApp } from './helpers.js'

// ApiRepo over the real Hono app and Postgres: the injected fetch is app.request with a cookie jar.
runRepoContract(
  'ApiRepo (HTTP -> Hono -> Postgres)',
  async (opts) => {
    const h = await setupApp()
    const res = await h.signUp(`u_${randomUUID()}@example.test`)
    if (res.status !== 200) throw new Error(`sign-up failed: ${res.status}`)
    const cookie = cookieJar(res)
    const fetchImpl = ((url: string, init: RequestInit = {}) => {
      const headers: Record<string, string> = {
        ...(init.headers as Record<string, string> | undefined),
        cookie,
        'x-test-client-ip': '203.0.113.9',
      }
      if (init.method && init.method !== 'GET') headers.origin = h.origin
      return h.app.request(url, { method: init.method, headers, body: init.body as string | undefined })
    }) as unknown as typeof fetch
    const repo = createApiRepo({ fetch: fetchImpl })
    if (!opts?.empty) await repo.init()
    return { repo, cleanup: h.cleanup, importAll: (data) => repo.importAll(data) }
  },
)
