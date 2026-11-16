import { describe, expect, it } from 'vitest'
import { AiFailedError, AiLimitError, AiUnavailableError, OfflineError, UnauthenticatedError, createApiRepo } from '../src/index.js'

type Seen = { url: string; method: string; body: unknown }
function repoWith(respond: () => Response | Error) {
  const seen: Seen[] = []
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    seen.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined })
    const r = respond()
    if (r instanceof Error) throw r
    return r
  }) as unknown as typeof fetch
  return { repo: createApiRepo({ fetch: fetchImpl }), seen }
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })

describe('ApiRepo nutrition', () => {
  it('lists a range, saves with PUT under the entry id, deletes, and parses', async () => {
    const { repo, seen } = repoWith(() => json(200, []))
    await repo.listNutrition('2026-11-10', '2026-11-16')
    await repo.saveNutritionEntry({ id: '11111111-1111-4111-8111-111111111111', date: '2026-11-16', name: 'x', quantity: '', calories: 1, protein_g: null, carbs_g: null, fat_g: null, fiber_g: null, sugar_g: null, sodium_mg: null, source: 'manual' })
    await repo.deleteNutritionEntry('11111111-1111-4111-8111-111111111111').catch(() => undefined)
    await repo.parseMeal('1 burrito')
    expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual([
      'GET /api/v1/nutrition/entries?from=2026-11-10&to=2026-11-16',
      'PUT /api/v1/nutrition/entries/11111111-1111-4111-8111-111111111111',
      'DELETE /api/v1/nutrition/entries/11111111-1111-4111-8111-111111111111',
      'POST /api/v1/nutrition/parse',
    ])
    expect(seen[1]!.body).not.toHaveProperty('id')
    expect(seen[3]!.body).toEqual({ text: '1 burrito' })
  })

  it('maps the AI errors to typed errors', async () => {
    const cases: [number, string, new () => Error][] = [
      [429, 'ai_limit', AiLimitError],
      [503, 'ai_unavailable', AiUnavailableError],
      [502, 'ai_failed', AiFailedError],
    ]
    for (const [status, error, Type] of cases) {
      const { repo } = repoWith(() => json(status, { error }))
      await expect(repo.parseMeal('x')).rejects.toBeInstanceOf(Type)
    }
  })

  it('401 is UnauthenticatedError and a network failure is OfflineError', async () => {
    await expect(repoWith(() => json(401, { error: 'unauthorized' })).repo.parseMeal('x')).rejects.toBeInstanceOf(UnauthenticatedError)
    await expect(repoWith(() => new TypeError('fetch failed')).repo.parseMeal('x')).rejects.toBeInstanceOf(OfflineError)
  })
})
