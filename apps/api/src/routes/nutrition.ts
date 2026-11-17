import { AiKeyBody, ParseMealBody, PutNutritionEntryBody, ValidationError, can, limit, nutritionSettingsOf } from '@workout/shared'
import type { AiKeyInfo } from '@workout/shared'
import { createMealParser } from '../ai/meal-parser.js'
import { openKey, sealKey } from '../ai/key-crypto.js'
import { UnsafeUrlError, assertPublicUrl, safeFetch } from '../ai/safe-fetch.js'
import type { AiKeyRow } from '../service/ai-key.js'
import { body, param, service } from './http.js'
import type { RouteDeps, V1 } from './types.js'

const DAY_MS = 86_400_000
const DEFAULT_RANGE_DAYS = 7
/** The server's calendar day (UTC): the day the AI allowance is counted against. */
const todayUtc = (): string => new Date().toISOString().slice(0, 10)
const daysAgo = (n: number): string => new Date(Date.now() - n * DAY_MS).toISOString().slice(0, 10)

const infoOf = (row: AiKeyRow | null): AiKeyInfo =>
  row ? { configured: true, provider: row.provider, base_url: row.baseUrl, model: row.model } : { configured: false }

export function registerNutrition(v1: V1, { getService, mealParser, aiKeySecret, userKeyFetch }: RouteDeps) {
  // The user's own AI provider. Write-only: the key is sealed on the way in and never comes back out.
  v1.get('/nutrition/ai-key', async (c) => {
    if (!aiKeySecret) return c.json(infoOf(null))
    const row = await service(c, getService).getAiKeyRow()
    // A key sealed under a different secret cannot be used, so it reads as not set
    return c.json(infoOf(row && openKey(aiKeySecret, row.keyEnc) !== null ? row : null))
  })
  v1.put('/nutrition/ai-key', async (c) => {
    const input = await body(c, AiKeyBody)
    if (!aiKeySecret) return c.json({ error: 'ai_unavailable' }, 503)
    const baseUrl = input.provider === 'openai' ? (input.base_url ?? null) : null
    if (baseUrl) {
      try {
        await assertPublicUrl(baseUrl)
      } catch (err) {
        if (err instanceof UnsafeUrlError) throw new ValidationError('base_url', err.message)
        throw err
      }
    }
    const row: AiKeyRow = { provider: input.provider, baseUrl, model: input.model, keyEnc: sealKey(aiKeySecret, input.api_key) }
    await service(c, getService).putAiKeyRow(row)
    return c.json(infoOf(row))
  })
  v1.delete('/nutrition/ai-key', async (c) => {
    await service(c, getService).deleteAiKey()
    return c.body(null, 204)
  })

  // Entries in a date range (at most 366 days); the last seven days when no range is given.
  v1.get('/nutrition/entries', async (c) => {
    const from = c.req.query('from') ?? daysAgo(DEFAULT_RANGE_DAYS - 1)
    const to = c.req.query('to') ?? todayUtc()
    return c.json(await service(c, getService).listNutrition(from, to))
  })
  v1.put('/nutrition/entries/:id', async (c) => {
    const id = param(c, 'id')
    const input = await body(c, PutNutritionEntryBody)
    return c.json(await service(c, getService).saveNutritionEntry({ ...input, id }))
  })
  v1.delete('/nutrition/entries/:id', async (c) => {
    const id = param(c, 'id')
    const s = service(c, getService)
    if (!(await s.owns('nutrition_entry', id))) return c.json({ error: 'not_found' }, 404)
    await s.deleteNutritionEntry(id)
    return c.body(null, 204)
  })

  // Estimates the foods in some text for the nutrients the caller tracks. Writes nothing: the app
  // saves what it keeps with PUT. Order: session, entitlement, body, parser available, daily cap,
  // parse. Availability comes before the cap so an unconfigured server never uses up an allowance;
  // the cap is taken before the call and is not refunded when the call fails.
  v1.post('/nutrition/parse', async (c) => {
    const s = service(c, getService)
    const profile = await s.getProfile()
    if (!can(profile, 'ai_nutrition')) return c.json({ error: 'forbidden' }, 403)
    const { text } = await body(c, ParseMealBody)
    // The user's own key wins, and their provider carries the cost, so it takes none of the daily allowance
    const row = await s.getAiKeyRow()
    const ownKey = row && aiKeySecret ? openKey(aiKeySecret, row.keyEnc) : null
    if (row && ownKey) {
      const own = createMealParser(
        { AI_PROVIDER: row.provider, AI_BASE_URL: row.baseUrl ?? undefined, AI_API_KEY: ownKey, AI_MODEL: row.model },
        userKeyFetch ?? safeFetch,
      )
      if (!own) return c.json({ error: 'ai_unavailable' }, 503)
      return c.json({ items: await own.parse(text, nutritionSettingsOf(profile).tracked), remaining_today: null })
    }
    if (!mealParser) return c.json({ error: 'ai_unavailable' }, 503)
    const remaining = await s.takeAiMeal(limit(profile, 'aiMealsPerDay'), todayUtc())
    if (remaining === null) return c.json({ error: 'ai_limit' }, 429)
    const items = await mealParser.parse(text, nutritionSettingsOf(profile).tracked)
    return c.json({ items, remaining_today: remaining })
  })
}

