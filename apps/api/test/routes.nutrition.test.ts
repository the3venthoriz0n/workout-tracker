import { AiFailedError, AiLimitError, AiUnavailableError, newId } from '@workout/shared'
import type { MealDraft, NutrientKey } from '@workout/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MealParser } from '../src/ai/meal-parser.js'
import { signUpClient, type Client } from './fixture.js'
import { setupApp, type Harness } from './helpers.js'

const day = (offset = 0) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)
const entry = (over: Record<string, unknown> = {}) => ({
  date: day(),
  name: 'Chicken burrito',
  quantity: '1 burrito',
  calories: 680,
  protein_g: 32,
  carbs_g: null,
  fat_g: null,
  fiber_g: null,
  sugar_g: null,
  sodium_mg: null,
  source: 'ai',
  ...over,
})

const draft = (tracked: NutrientKey[]): MealDraft => ({
  name: 'Test food',
  quantity: '1',
  calories: tracked.includes('calories') ? 100 : null,
  protein_g: tracked.includes('protein_g') ? 5 : null,
  carbs_g: tracked.includes('carbs_g') ? 10 : null,
  fat_g: tracked.includes('fat_g') ? 2 : null,
  fiber_g: null,
  sugar_g: null,
  sodium_mg: null,
})

function stubParser(behaviour?: (text: string, tracked: NutrientKey[]) => Promise<MealDraft[]>) {
  const parse = vi.fn(behaviour ?? (async (_t: string, tracked: NutrientKey[]) => [draft(tracked)]))
  const parser: MealParser = { parse }
  return { parser, parse }
}

let h: Harness
let u: Client
afterEach(async () => {
  await h?.cleanup()
})

async function boot(parser: MealParser | null, email = 'nutrition@example.com') {
  h = await setupApp({}, { mealParser: parser })
  u = await signUpClient(h, email)
  await u.call('POST', '/api/v1/me/init')
}

describe('POST /nutrition/parse', () => {
  it('returns drafts for the tracked nutrients only and writes nothing', async () => {
    const { parser, parse } = stubParser()
    await boot(parser)
    const res = await u.call('POST', '/api/v1/nutrition/parse', { text: '  1 chicken burrito  ' })
    expect(res.status).toBe(200)
    const body = res.json as { items: MealDraft[]; remaining_today: number }
    expect(body.remaining_today).toBe(29)
    expect(body.items[0]).toMatchObject({ name: 'Test food', calories: 100, protein_g: 5, carbs_g: null })
    expect(parse).toHaveBeenCalledWith('1 chicken burrito', ['calories', 'protein_g'])

    await u.call('PATCH', '/api/v1/me', { nutrition: { tracked: ['fat_g', 'calories'], goals: {} } })
    await u.call('POST', '/api/v1/nutrition/parse', { text: 'toast' })
    expect(parse).toHaveBeenLastCalledWith('toast', ['calories', 'fat_g'])

    const list = await u.call('GET', `/api/v1/nutrition/entries?from=${day(-1)}&to=${day()}`)
    expect(list.json).toEqual([])
  })

  it('over the daily limit is 429 ai_limit and does not call the parser', async () => {
    const { parser, parse } = stubParser()
    await boot(parser)
    for (let i = 0; i < 30; i++) expect((await u.call('POST', '/api/v1/nutrition/parse', { text: 'x' })).status).toBe(200)
    const res = await u.call('POST', '/api/v1/nutrition/parse', { text: 'x' })
    expect(res.status).toBe(429)
    expect(res.json).toEqual({ error: 'ai_limit' })
    expect(parse).toHaveBeenCalledTimes(30)
  })

  it('without a configured parser is 503 ai_unavailable and never uses up the allowance', async () => {
    await boot(null)
    for (let i = 0; i < 32; i++) {
      const res = await u.call('POST', '/api/v1/nutrition/parse', { text: 'x' })
      expect(res.status).toBe(503)
      expect(res.json).toEqual({ error: 'ai_unavailable' })
    }
  })

  it.each([
    ['AiFailedError', () => new AiFailedError(), 502, 'ai_failed'],
    ['AiLimitError', () => new AiLimitError(), 429, 'ai_limit'],
    ['AiUnavailableError', () => new AiUnavailableError(), 503, 'ai_unavailable'],
  ])('a parser %s maps to %i %s with no provider text', async (_n, make, code, error) => {
    const { parser } = stubParser(async () => {
      throw make()
    })
    await boot(parser)
    const res = await u.call('POST', '/api/v1/nutrition/parse', { text: 'my secret lunch' })
    expect(res.status).toBe(code)
    expect(res.json).toEqual({ error })
    expect(res.text).not.toContain('secret lunch')
  })

  it('an unexpected parser failure is the sanitized 500, never its message or the text', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { parser } = stubParser(async () => {
      throw new Error('provider said: key sk-abc and text my secret lunch')
    })
    await boot(parser)
    const res = await u.call('POST', '/api/v1/nutrition/parse', { text: 'my secret lunch' })
    expect(res.status).toBe(500)
    expect(res.json).toEqual({ error: 'internal_error' })
    expect(res.text).not.toContain('sk-abc')
    err.mockRestore()
  })

  it.each([['empty', ''], ['whitespace', '   '], ['too long', 'x'.repeat(501)], ['not a string', 5]])('%s text is 400', async (_n, text) => {
    const { parser, parse } = stubParser()
    await boot(parser)
    expect((await u.call('POST', '/api/v1/nutrition/parse', { text })).status).toBe(400)
    expect((await u.call('POST', '/api/v1/nutrition/parse', {})).status).toBe(400)
    expect(parse).not.toHaveBeenCalled()
  })

  it('needs a session, a trusted Origin and a JSON body', async () => {
    const { parser, parse } = stubParser()
    await boot(parser)
    expect((await u.call('POST', '/api/v1/nutrition/parse', { text: 'x' }, { cookie: null })).status).toBe(401)
    const evil = await h.request('/api/v1/nutrition/parse', { method: 'POST', body: { text: 'x' }, cookie: u.cookie, origin: 'https://evil.example' })
    expect(evil.status).toBe(403)
    const notJson = await h.request('/api/v1/nutrition/parse', { method: 'POST', rawBody: 'text=x', contentType: 'text/plain', cookie: u.cookie })
    expect(notJson.status).toBeGreaterThanOrEqual(400)
    expect(parse).not.toHaveBeenCalled()
  })
})

describe('/nutrition/entries', () => {
  beforeEach(async () => {
    await boot(stubParser().parser)
  })

  it('saves with PUT, lists by range, and deletes with 204 then 404', async () => {
    const id = newId()
    const put = await u.call('PUT', `/api/v1/nutrition/entries/${id}`, entry())
    expect(put.status).toBe(200)
    expect(put.json).toMatchObject({ id, name: 'Chicken burrito', calories: 680 })
    expect((await u.call('PUT', `/api/v1/nutrition/entries/${id}`, entry({ calories: 700 }))).status).toBe(200)
    const list = await u.call('GET', `/api/v1/nutrition/entries?from=${day()}&to=${day()}`)
    expect((list.json as { calories: number }[]).map((e) => e.calories)).toEqual([700])
    expect((await u.call('DELETE', `/api/v1/nutrition/entries/${id}`)).status).toBe(204)
    expect((await u.call('DELETE', `/api/v1/nutrition/entries/${id}`)).status).toBe(404)
    expect((await u.call('GET', `/api/v1/nutrition/entries?from=${day()}&to=${day()}`)).json).toEqual([])
  })

  it('without a range lists the last seven days', async () => {
    await u.call('PUT', `/api/v1/nutrition/entries/${newId()}`, entry({ date: day(-6), name: 'inside' }))
    await u.call('PUT', `/api/v1/nutrition/entries/${newId()}`, entry({ date: day(-7), name: 'outside' }))
    const list = await u.call('GET', '/api/v1/nutrition/entries')
    expect((list.json as { name: string }[]).map((e) => e.name)).toEqual(['inside'])
  })

  it('refuses a date outside the window, a bad body and a range over 366 days with 400', async () => {
    const id = newId()
    for (const bad of [entry({ date: '2093-01-01' }), entry({ date: day(-367) }), entry({ calories: 10_001 }), entry({ source: 'robot' }), { ...entry(), name: undefined }]) {
      expect((await u.call('PUT', `/api/v1/nutrition/entries/${id}`, bad)).status).toBe(400)
    }
    expect((await u.call('GET', `/api/v1/nutrition/entries?from=${day(-400)}&to=${day()}`)).status).toBe(400)
    expect((await u.call('GET', '/api/v1/nutrition/entries?from=nope&to=nope')).status).toBe(400)
  })

  it("another user's entry is a 404 on delete and never appears in their list", async () => {
    const id = newId()
    await u.call('PUT', `/api/v1/nutrition/entries/${id}`, entry())
    const other = await signUpClient(h, 'other-nutrition@example.com')
    await other.call('POST', '/api/v1/me/init')
    expect((await other.call('DELETE', `/api/v1/nutrition/entries/${id}`)).status).toBe(404)
    expect((await other.call('GET', `/api/v1/nutrition/entries?from=${day()}&to=${day()}`)).json).toEqual([])
    expect(((await u.call('GET', `/api/v1/nutrition/entries?from=${day()}&to=${day()}`)).json as unknown[]).length).toBe(1)
  })
})

describe('PATCH /me nutrition', () => {
  beforeEach(async () => {
    await boot(stubParser().parser)
  })

  it('validates tracked metrics and goals and echoes them back in canonical order', async () => {
    const ok = await u.call('PATCH', '/api/v1/me', { nutrition: { tracked: ['protein_g', 'calories'], goals: { calories: 2400 } } })
    expect(ok.status).toBe(200)
    expect((ok.json as { nutrition: unknown }).nutrition).toEqual({ tracked: ['calories', 'protein_g'], goals: { calories: 2400 } })
    for (const bad of [{ tracked: [], goals: {} }, { tracked: ['zinc'], goals: {} }, { tracked: ['calories', 'calories'], goals: {} }, { tracked: ['calories'], goals: { calories: 99_999 } }]) {
      expect((await u.call('PATCH', '/api/v1/me', { nutrition: bad })).status).toBe(400)
    }
    expect(((await u.call('GET', '/api/v1/me')).json as { nutrition: { tracked: string[] } }).nutrition.tracked).toEqual(['calories', 'protein_g'])
  })
})
