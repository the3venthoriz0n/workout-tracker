import { describe, expect, it } from 'vitest'
import { createApiRepo } from '../src/api-repo.js'
import {
  AlreadyHasDataError,
  ApiError,
  ImportInvalidError,
  NotFoundError,
  OfflineError,
  ProfileNotFoundError,
  SessionInProgressError,
  UnauthenticatedError,
} from '../src/repo.js'
import type { ExportData } from '../src/repo.js'

type Call = { url: string; init: RequestInit }
function stub(status: number, body?: unknown) {
  const calls: Call[] = []
  const fetchStub = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(body === undefined ? null : JSON.stringify(body), { status })
  }) as unknown as typeof fetch
  return { calls, repo: createApiRepo({ fetch: fetchStub }) }
}

describe('ApiRepo error mapping', () => {
  it('maps 401 to UnauthenticatedError', async () => {
    await expect(stub(401, { error: 'unauthorized' }).repo.listGear()).rejects.toBeInstanceOf(UnauthenticatedError)
  })
  it('maps a network failure to OfflineError', async () => {
    const repo = createApiRepo({
      fetch: (async () => {
        throw new TypeError('Failed to fetch')
      }) as unknown as typeof fetch,
    })
    await expect(repo.listGear()).rejects.toBeInstanceOf(OfflineError)
  })
  it('maps 409 codes', async () => {
    await expect(stub(409, { error: 'session_in_progress' }).repo.startSession('d')).rejects.toBeInstanceOf(
      SessionInProgressError,
    )
    await expect(stub(409, { error: 'already_has_data' }).repo.importAll({} as ExportData)).rejects.toBeInstanceOf(
      AlreadyHasDataError,
    )
  })
  it('maps 400 on import to ImportInvalidError, elsewhere to ApiError', async () => {
    await expect(stub(400, { error: 'invalid' }).repo.importAll({} as ExportData)).rejects.toBeInstanceOf(
      ImportInvalidError,
    )
    await expect(stub(400, { error: 'invalid' }).repo.savePlan({ name: 'x' })).rejects.toBeInstanceOf(ApiError)
  })
  it('maps 404 to NotFoundError, ProfileNotFoundError for /me and /export, undefined for plan/session gets', async () => {
    await expect(stub(404, { error: 'not_found' }).repo.deletePlan('p')).rejects.toBeInstanceOf(NotFoundError)
    await expect(stub(404).repo.getProfile()).rejects.toBeInstanceOf(ProfileNotFoundError)
    await expect(stub(404).repo.exportAll()).rejects.toBeInstanceOf(ProfileNotFoundError)
    expect(await stub(404).repo.getPlan('p')).toBeUndefined()
    expect(await stub(404).repo.getSession('s')).toBeUndefined()
  })
  it('maps other failures to ApiError with status and code only, never the body', async () => {
    const err = await stub(500, { error: 'internal_error', secret: 'SECRET-DETAIL' }).repo.listGear().catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(500)
    expect(err.message).not.toContain('SECRET-DETAIL')
    const html = await stub(502).repo.listGear().catch((e) => e)
    expect(html).toMatchObject({ status: 502 })
  })
})

describe('ApiRepo requests', () => {
  it('sends Content-Type and a JSON body on every state-changing request, none on GET', async () => {
    const s = stub(200, {})
    const r = s.repo
    await r.init()
    await r.updateProfile({ units: 'kg' })
    await r.saveGear({ name: 'g', owned: true })
    await r.deleteGear('g1')
    await r.deletePlan('p1')
    await r.move('item', 'i1', 1)
    await r.setRule('i1', null)
    await r.finishSession('s1')
    await r.discardSession('s1')
    await r.addPlanItem('d1', 'e1')
    await r.listGear()
    await r.exportAll()
    const changing = s.calls.filter((c) => c.init.method !== 'GET')
    expect(changing.length).toBe(10)
    for (const c of changing) {
      expect((c.init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
      expect(typeof c.init.body).toBe('string')
      expect(() => JSON.parse(c.init.body as string)).not.toThrow()
      expect(c.init.credentials).toBe('include')
    }
    expect(JSON.parse(changing[0]!.init.body as string)).toEqual({})
    for (const c of s.calls.filter((x) => x.init.method === 'GET')) expect(c.init.body).toBeUndefined()
  })
  it('creates with idempotent PUT to a client-generated id and honours baseUrl', async () => {
    const calls: Call[] = []
    const repo = createApiRepo({
      baseUrl: 'https://api.example.test/',
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, init })
        return new Response('{}', { status: 200 })
      }) as unknown as typeof fetch,
    })
    await repo.savePlan({ name: 'A' })
    await repo.savePlan({ id: 'fixed-id', name: 'B' })
    expect(calls[0]!.init.method).toBe('PUT')
    expect(calls[0]!.url).toMatch(/^https:\/\/api\.example\.test\/api\/v1\/plans\/[0-9a-f-]{36}$/)
    expect(calls[1]!.url).toBe('https://api.example.test/api/v1/plans/fixed-id')
    expect(JSON.parse(calls[1]!.init.body as string)).toEqual({ name: 'B' })
  })
})

describe('ApiRepo: day colours, angle, AMRAP, supersets and layered rules', () => {
  it('maps a 400 invalid to ValidationError, which is still an ApiError(400) for the offline queue', async () => {
    const { ValidationError } = await import('../src/repo.js')
    const err = await stub(400, { error: 'invalid', issues: [{ path: 'angle', message: 'x' }] })
      .repo.updatePlanItem('i', { angle: 'incline' })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ValidationError)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ name: 'ValidationError', status: 400, code: 'invalid' })
  })
  it('calls the new routes', async () => {
    const s = stub(200, {})
    await s.repo.setSuperset('d1', 'g1', ['i1', 'i2'])
    await s.repo.setSuperset('d1', 'g1', null)
    await s.repo.clearRule('i1')
    await s.repo.setExerciseRule('e1', null)
    await s.repo.listProgressionByExercise()
    expect(s.calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
      'PUT /api/v1/days/d1/supersets/g1',
      'PUT /api/v1/days/d1/supersets/g1',
      'DELETE /api/v1/items/i1/rule',
      'PUT /api/v1/exercises/e1/rule',
      'GET /api/v1/progression/exercises',
    ])
    expect(JSON.parse(s.calls[0]!.init.body as string)).toEqual({ item_ids: ['i1', 'i2'] })
    expect(JSON.parse(s.calls[1]!.init.body as string)).toEqual({ item_ids: null })
    expect(JSON.parse(s.calls[3]!.init.body as string)).toEqual({ rule: null })
  })
})

describe('ApiRepo: community plans', () => {
  it('calls the community routes and never sends a client snapshot when adopting', async () => {
    const s = stub(200, {})
    await s.repo.publishPlan('p1', { title: 'Strong 5x5', description: 'd', level: 'beginner' })
    await s.repo.unpublishPlan('p1')
    await s.repo.listMyShared()
    await s.repo.setVote('l1', true)
    await s.repo.setVote('l1', false)
    await s.repo.adoptSharedPlan({
      shared_plan_id: 'l1',
      version: 2,
      snapshot: { name: 'FORGED', units: 'lb', days: [] },
      title: 'FORGED',
      author: 'FORGED',
    })
    await s.repo.adoptSharedPlan({ shared_plan_id: 'l1' })
    expect(s.calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
      'POST /api/v1/plans/p1/publish',
      'DELETE /api/v1/plans/p1/publish',
      'GET /api/v1/shared-plans/mine',
      'PUT /api/v1/shared-plans/l1/vote',
      'DELETE /api/v1/shared-plans/l1/vote',
      'POST /api/v1/shared-plans/l1/adopt',
      'POST /api/v1/shared-plans/l1/adopt',
    ])
    expect(JSON.parse(s.calls[0]!.init.body as string)).toEqual({ title: 'Strong 5x5', description: 'd', level: 'beginner' })
    expect(JSON.parse(s.calls[5]!.init.body as string)).toEqual({ version: 2 })
    expect(JSON.parse(s.calls[6]!.init.body as string)).toEqual({})
  })
  it('hasVoted reads GET /shared-plans/:id/vote', async () => {
    const s = stub(200, { voted: true })
    expect(await s.repo.hasVoted('l1')).toBe(true)
    expect(`${s.calls[0]!.init.method} ${s.calls[0]!.url}`).toBe('GET /api/v1/shared-plans/l1/vote')
  })
  it('maps 429 publish_limit to PublishLimitError (an ApiError 429)', async () => {
    const { PublishLimitError } = await import('../src/repo.js')
    const err = await stub(429, { error: 'publish_limit' }).repo.publishPlan('p1', { title: 'abc' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PublishLimitError)
    expect(err).toMatchObject({ status: 429, code: 'publish_limit' })
  })
})

describe('ApiRepo: own listing', () => {
  it('maps 409 own_listing to OwnListingError', async () => {
    const { OwnListingError } = await import('../src/repo.js')
    const err = await stub(409, { error: 'own_listing' }).repo.setVote('l1', true).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(OwnListingError)
    expect(err).toMatchObject({ status: 409, code: 'own_listing' })
  })
})

describe('ApiRepo.replaceAll (restore)', () => {
  const data = { version: 1 } as unknown as ExportData
  it('POSTs { password, data } to /import/replace', async () => {
    const s = stub(204)
    await s.repo.replaceAll('pw 1234567890', data)
    expect(s.calls[0]!.url).toBe('/api/v1/import/replace')
    expect(s.calls[0]!.init.method).toBe('POST')
    expect(JSON.parse(s.calls[0]!.init.body as string)).toEqual({ password: 'pw 1234567890', data })
  })
  it('maps 400 to ImportInvalidError and keeps the other codes', async () => {
    await expect(stub(400, { error: 'invalid' }).repo.replaceAll('p', data)).rejects.toBeInstanceOf(ImportInvalidError)
    await expect(stub(403, { error: 'invalid_password' }).repo.replaceAll('p', data)).rejects.toMatchObject({ status: 403, code: 'invalid_password' })
    await expect(stub(409, { error: 'has_published' }).repo.replaceAll('p', data)).rejects.toMatchObject({ status: 409, code: 'has_published' })
    await expect(stub(429, { error: 'rate_limited' }).repo.replaceAll('p', data)).rejects.toMatchObject({ status: 429, code: 'rate_limited' })
  })
})
