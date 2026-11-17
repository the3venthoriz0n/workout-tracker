import { ParseMealBody, PutNutritionEntryBody, can, limit, nutritionSettingsOf } from '@workout/shared'
import { body, param, service } from './http.js'
import type { RouteDeps, V1 } from './types.js'

const DAY_MS = 86_400_000
const DEFAULT_RANGE_DAYS = 7
/** The server's calendar day (UTC): the day the AI allowance is counted against. */
const todayUtc = (): string => new Date().toISOString().slice(0, 10)
const daysAgo = (n: number): string => new Date(Date.now() - n * DAY_MS).toISOString().slice(0, 10)

export function registerNutrition(v1: V1, { getService, mealParser }: RouteDeps) {
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
    if (!mealParser) return c.json({ error: 'ai_unavailable' }, 503)
    const remaining = await s.takeAiMeal(limit(profile, 'aiMealsPerDay'), todayUtc())
    if (remaining === null) return c.json({ error: 'ai_limit' }, 429)
    const items = await mealParser.parse(text, nutritionSettingsOf(profile).tracked)
    return c.json({ items, remaining_today: remaining })
  })
}

