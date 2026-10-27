// Read-only client for the public community area (`/api/public/*`). Plain fetch, no cookies,
// the same error mapping as ApiRepo. Responses are untrusted: they are parsed against the public
// schemas (unknown keys dropped) and a response that does not match is an ApiError.
import type { z } from 'zod'
import { readJson, responseError } from './api-repo.js'
import { publicListPageSchema, publicPlanDetailSchema } from './community.js'
import type { PublicListPage, PublicListQuery, PublicPlanDetail } from './community.js'
import { ApiError, OfflineError } from './repo.js'

export type PublicApiOptions = {
  /** Prefix for every request URL (default: same origin, relative URLs). */
  baseUrl?: string
  /** Injectable for tests; defaults to the global fetch. */
  fetch?: typeof fetch
}

async function getPublic<S extends z.ZodType>(path: string, schema: S, opts: PublicApiOptions): Promise<z.infer<S>> {
  let base = opts.baseUrl ?? ''
  while (base.endsWith('/')) base = base.slice(0, -1)
  let res: Response
  try {
    res = await (opts.fetch ?? globalThis.fetch)(`${base}/api/public${path}`, { method: 'GET', credentials: 'omit' })
  } catch {
    throw new OfflineError()
  }
  const data = await readJson(res)
  if (!res.ok) throw responseError(res.status, data)
  const parsed = schema.safeParse(data)
  if (!parsed.success) throw new ApiError(res.status, 'invalid_response')
  return parsed.data
}

/** `GET /api/public/plans`: one page of published listings (at most 20) and the next cursor. */
export function fetchCommunityList(params: PublicListQuery, opts: PublicApiOptions = {}): Promise<PublicListPage> {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v))
  const query = qs.toString()
  return getPublic(`/plans${query ? `?${query}` : ''}`, publicListPageSchema, opts)
}

/** `GET /api/public/plans/:id` (latest version) or `.../versions/:n`. */
export function fetchCommunityPlan(
  id: string,
  opts: PublicApiOptions & { version?: number } = {},
): Promise<PublicPlanDetail> {
  const path = `/plans/${encodeURIComponent(id)}${opts.version === undefined ? '' : `/versions/${opts.version}`}`
  return getPublic(path, publicPlanDetailSchema, opts)
}
