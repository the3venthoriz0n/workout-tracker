import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { ValidationError, newId } from '@workout/shared'
import type { NutritionEntryInput } from '@workout/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as t from '../src/db/schema.js'
import { createService } from '../src/service/index.js'
import { type TestDb, withTestDb } from './harness.js'

let h: TestDb
beforeEach(async () => {
  h = await withTestDb()
})
afterEach(async () => {
  await h?.cleanup()
})

async function makeService() {
  const id = `u_${randomUUID()}`
  await h.db.insert(t.user).values({ id, name: id, email: `${id}@example.test` })
  const s = createService(h.db, id)
  await s.init()
  return { s, userId: id }
}

/** A calendar date `offset` days from today (UTC), as YYYY-MM-DD. */
const day = (offset = 0) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)
const today = day()

const entry = (over: Partial<NutritionEntryInput> = {}): NutritionEntryInput => ({
  date: today,
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

describe('service nutrition', () => {
  it('save is idempotent for one id and replaces the row', async () => {
    const { s } = await makeService()
    const id = newId()
    await s.saveNutritionEntry(entry({ id }))
    await s.saveNutritionEntry(entry({ id, calories: 700, source: 'manual' }))
    const list = await s.listNutrition(today, today)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id, calories: 700, source: 'manual', name: 'Chicken burrito' })
  })

  it('two users can use the same id and see only their own entries', async () => {
    const a = await makeService()
    const b = await makeService()
    const id = newId()
    await a.s.saveNutritionEntry(entry({ id, name: 'A food' }))
    await b.s.saveNutritionEntry(entry({ id, name: 'B food' }))
    expect((await a.s.listNutrition(today, today)).map((e) => e.name)).toEqual(['A food'])
    expect((await b.s.listNutrition(today, today)).map((e) => e.name)).toEqual(['B food'])
  })

  it("a foreign user's entry is not owned, never listed, and a delete from another account leaves it", async () => {
    const a = await makeService()
    const b = await makeService()
    const saved = await a.s.saveNutritionEntry(entry())
    expect(await a.s.owns('nutrition_entry', saved.id)).toBe(true)
    expect(await b.s.owns('nutrition_entry', saved.id)).toBe(false)
    await b.s.deleteNutritionEntry(saved.id)
    expect(await b.s.listNutrition(today, today)).toEqual([])
    expect(await a.s.listNutrition(today, today)).toHaveLength(1)
  })

  it('delete soft-deletes and list ignores it', async () => {
    const { s, userId } = await makeService()
    const saved = await s.saveNutritionEntry(entry())
    await s.deleteNutritionEntry(saved.id)
    expect(await s.listNutrition(today, today)).toEqual([])
    expect(await s.owns('nutrition_entry', saved.id)).toBe(false)
    const [row] = await h.db.select().from(t.nutritionEntry).where(eq(t.nutritionEntry.userId, userId))
    expect(row?.deletedAt).not.toBeNull()
  })

  it('a date outside the window is a ValidationError, and one inside it is saved', async () => {
    const { s } = await makeService()
    for (const date of [day(-366), day(3), '2093-01-01']) {
      await expect(s.saveNutritionEntry(entry({ date }))).rejects.toBeInstanceOf(ValidationError)
    }
    await s.saveNutritionEntry(entry({ date: day(-365) }))
    await s.saveNutritionEntry(entry({ date: day(2) }))
    expect(await s.listNutrition(day(-365), day(-365))).toHaveLength(1)
    expect(await s.listNutrition(day(2), day(2))).toHaveLength(1)
  })

  it('the 301st entry on a date is a ValidationError; replacing an existing one is still allowed', async () => {
    const { s } = await makeService()
    const first = newId()
    await s.saveNutritionEntry(entry({ id: first }))
    for (let i = 1; i < 300; i++) await s.saveNutritionEntry(entry({ name: `Food ${i}` }))
    await expect(s.saveNutritionEntry(entry({ name: 'One too many' }))).rejects.toBeInstanceOf(ValidationError)
    await s.saveNutritionEntry(entry({ id: first, calories: 1 }))
    expect(await s.listNutrition(today, today)).toHaveLength(300)
  })

  it('list orders by date then created time and rejects a range over 366 days', async () => {
    const { s } = await makeService()
    const late = await s.saveNutritionEntry(entry({ date: day(0), name: 'second' }))
    await s.saveNutritionEntry(entry({ date: day(-1), name: 'first' }))
    const third = await s.saveNutritionEntry(entry({ date: day(0), name: 'third' }))
    expect((await s.listNutrition(day(-1), day(0))).map((e) => e.name)).toEqual(['first', 'second', 'third'])
    expect(late.id).not.toBe(third.id)
    await expect(s.listNutrition(day(-366), day(0))).rejects.toBeInstanceOf(ValidationError)
    await expect(s.listNutrition(day(0), day(-1))).rejects.toBeInstanceOf(ValidationError)
    await expect(s.listNutrition('nope', day(0))).rejects.toBeInstanceOf(ValidationError)
  })

  it('takeAiMeal counts a parse, reports what remains, and stops at the limit', async () => {
    const { s } = await makeService()
    expect(await s.takeAiMeal(3, today)).toBe(2)
    expect(await s.takeAiMeal(3, today)).toBe(1)
    expect(await s.takeAiMeal(3, today)).toBe(0)
    expect(await s.takeAiMeal(3, today)).toBeNull()
    // Another day starts again
    expect(await s.takeAiMeal(3, day(1))).toBe(2)
  })

  it('takeAiMeal fails closed on a limit that is not a positive whole number', async () => {
    const { s } = await makeService()
    for (const limit of [0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(await s.takeAiMeal(limit, today), String(limit)).toBeNull()
    }
    // Nothing was counted by the refused calls
    expect(await s.takeAiMeal(1, today)).toBe(0)
  })

  it('parallel saves cannot push a day past 300 entries', async () => {
    const { s } = await makeService()
    for (let i = 0; i < 299; i++) await s.saveNutritionEntry(entry({ name: `Food ${i}` }))
    const results = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => s.saveNutritionEntry(entry({ name: `Race ${i}` }))))
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((r) => r.status === 'rejected' && r.reason instanceof ValidationError)).toHaveLength(5)
    expect(await s.listNutrition(today, today)).toHaveLength(300)
  })

  it('two parallel takeAiMeal calls at limit minus one allow exactly one', async () => {
    const { s } = await makeService()
    expect(await s.takeAiMeal(3, today)).toBe(2)
    expect(await s.takeAiMeal(3, today)).toBe(1)
    const results = await Promise.all([s.takeAiMeal(3, today), s.takeAiMeal(3, today)])
    expect(results.filter((r) => r !== null)).toHaveLength(1)
    expect(results.filter((r) => r === null)).toHaveLength(1)
  })

  it('updateProfile stores and returns nutrition settings, and getProfile shows them', async () => {
    const { s } = await makeService()
    expect((await s.getProfile()).nutrition).toBeUndefined()
    const updated = await s.updateProfile({ nutrition: { tracked: ['protein_g', 'calories'], goals: { calories: 2400 } } })
    expect(updated.nutrition).toEqual({ tracked: ['calories', 'protein_g'], goals: { calories: 2400 } })
    expect((await s.getProfile()).nutrition?.goals.calories).toBe(2400)
  })

  it('export then replace round-trips entries and nutrition settings', async () => {
    const { s } = await makeService()
    await s.updateProfile({ nutrition: { tracked: ['calories'], goals: { calories: 2000 } } })
    const a = await s.saveNutritionEntry(entry({ name: 'Keep' }))
    const b = await s.saveNutritionEntry(entry({ date: day(-1), name: 'Also keep' }))
    const data = await s.exportAll()
    expect(data.nutrition_entries?.map((e) => e.id).sort()).toEqual([a.id, b.id].sort())
    await s.deleteNutritionEntry(a.id)
    await s.updateProfile({ nutrition: { tracked: ['protein_g'], goals: {} } })
    await s.replaceAll(data)
    expect((await s.listNutrition(day(-1), today)).map((e) => e.name).sort()).toEqual(['Also keep', 'Keep'])
    expect((await s.getProfile()).nutrition).toEqual({ tracked: ['calories'], goals: { calories: 2000 } })
  })

  it('an import into a new account brings its entries', async () => {
    const a = await makeService()
    await a.s.saveNutritionEntry(entry({ name: 'Travels' }))
    const data = await a.s.exportAll()
    const id = `u_${randomUUID()}`
    await h.db.insert(t.user).values({ id, name: id, email: `${id}@example.test` })
    const fresh = createService(h.db, id)
    await fresh.importAll(data)
    expect((await fresh.listNutrition(today, today)).map((e) => e.name)).toEqual(['Travels'])
  })

  it('account deletion removes entries and usage', async () => {
    const { s, userId } = await makeService()
    await s.saveNutritionEntry(entry())
    await s.takeAiMeal(5, today)
    await s.deleteAccount()
    expect(await h.db.select().from(t.nutritionEntry).where(eq(t.nutritionEntry.userId, userId))).toEqual([])
    expect(await h.db.select().from(t.aiUsage).where(eq(t.aiUsage.userId, userId))).toEqual([])
  })
})
