// Follow-up hardening: decimals, rule amounts, clamping, import plan, future timestamps.
import { newId, type ExportData } from '@workout/shared'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { exercise, planItem, progressionRule } from '../src/db/schema.js'
import { buildFixture, signUpClient, type Client } from './fixture.js'
import { setupApp, type Harness } from './helpers.js'

let h: Harness
let u: Client
beforeAll(async () => {
  h = await setupApp()
  u = await signUpClient(h, 'inputs@example.com')
})
afterAll(async () => {
  await h?.cleanup()
})

const rule = (over: Record<string, unknown>) => ({
  success_action: 'add_weight', success_amount: 5, fail_streak_limit: 3, deload_pct: 10, rep_ceiling: null, ...over,
})

describe('2-decimal storage', () => {
  it.each([0.001, 0.005, 0, 1.234, 2.505])('rejects weight_increment %s', async (v) => {
    await u.call('POST', '/api/v1/me/init')
    expect((await u.call('PATCH', '/api/v1/me', { weight_increment: v })).status).toBe(400)
    expect((await u.call('GET', '/api/v1/me')).status).toBe(200)
  })
  it('accepts 0.01 and 2.5', async () => {
    expect((await u.call('PATCH', '/api/v1/me', { weight_increment: 0.01 })).status).toBe(200)
    expect((await u.call('PATCH', '/api/v1/me', { weight_increment: 2.5 })).status).toBe(200)
  })
  it.each([0.001, 1.234])('rejects rule success_amount %s (rule and default_rule)', async (v) => {
    const f = await buildFixture(u)
    expect((await u.call('PUT', `/api/v1/items/${f.item}/rule`, { rule: rule({ success_amount: v }) })).status).toBe(400)
    expect((await u.call('PATCH', '/api/v1/me', { default_rule: rule({ success_amount: v }) })).status).toBe(400)
  })
})

describe('add_reps amounts', () => {
  it.each([1.5, 1001, 0.5])('rejects %s', async (v) => {
    const f = await buildFixture(u)
    const res = await u.call('PUT', `/api/v1/items/${f.item}/rule`, { rule: rule({ success_action: 'add_reps', success_amount: v }) })
    expect(res.status).toBe(400)
  })
  it('accepts a whole number', async () => {
    const f = await buildFixture(u)
    const res = await u.call('PUT', `/api/v1/items/${f.item}/rule`, { rule: rule({ success_action: 'add_reps', success_amount: 2 }) })
    expect(res.status).toBe(200)
  })
})

describe('values beyond the bound never lock an account', () => {
  it('a unit change clamps converted weights and rule amounts to 100000', async () => {
    const f = await buildFixture(u)
    await u.call('PATCH', '/api/v1/me', { units: 'kg' })
    const put = await u.call('PUT', `/api/v1/exercises/${f.exercise}`, {
      name: 'Big', notes: '', video_url: null, required_gear_ids: [], active: true,
      default_sets: 1, default_reps: 1, default_weight: 90000,
    })
    expect(put.status).toBe(200)
    await u.call('PUT', `/api/v1/items/${f.item}/rule`, { rule: rule({ success_amount: 90000 }) })
    expect((await u.call('PATCH', '/api/v1/me', { units: 'lb' })).status).toBe(200)
    const ex = (await u.call('GET', '/api/v1/exercises')).json as { id: string; default_weight: number }[]
    expect(ex.find((e) => e.id === f.exercise)?.default_weight).toBe(100000)
    const prog = (await u.call('GET', '/api/v1/progression')).json as { item_id: string; rule: { success_amount: number } }[]
    expect(prog.find((p) => p.item_id === f.item)?.rule.success_amount).toBeLessThanOrEqual(100000)
  })

  it('an out-of-range stored row is clamped on read, and edits and unit changes still work', async () => {
    const f = await buildFixture(u)
    await h.db.update(planItem).set({ weight: '999999.99', targetWeight: '500000.00' }).where(eq(planItem.id, f.item))
    await h.db.update(exercise).set({ defaultWeight: '700000.00' }).where(eq(exercise.id, f.exercise))
    await h.db.update(progressionRule).set({ successAmount: '0.00' }).where(eq(progressionRule.planItemId, f.item))
    expect((await u.call('GET', '/api/v1/me')).status).toBe(200)
    expect((await u.call('GET', `/api/v1/plans/${f.plan}`)).status).toBe(200)
    expect((await u.call('GET', '/api/v1/progression')).status).toBe(200)
    expect((await u.call('GET', '/api/v1/exercises')).status).toBe(200)
    expect((await u.call('GET', '/api/v1/export')).status).toBe(200)
    const item = await u.call('PATCH', `/api/v1/items/${f.item}`, { sets: 3 })
    expect(item.status).toBe(200)
    expect((item.json as { weight: number }).weight).toBeLessThanOrEqual(100000)
    expect((await u.call('PATCH', '/api/v1/me', { units: 'kg' })).status).toBe(200)
    expect((await u.call('PATCH', '/api/v1/me', { weight_increment: 2.5 })).status).toBe(200)
  })
})

describe('import cannot choose the plan tier', () => {
  it('forces profile.plan to free', async () => {
    const f = await buildFixture(u)
    const data: ExportData = { ...f.export, profile: { ...f.export.profile, plan: 'pro' } }
    const fresh = await signUpClient(h, `pro-${newId()}@example.com`)
    expect((await fresh.call('POST', '/api/v1/import', data)).status).toBe(204)
    expect(((await fresh.call('GET', '/api/v1/me')).json as { plan: string }).plan).toBe('free')
  })
})

describe('PATCH /sets updated_at', () => {
  it('rejects timestamps more than 5 minutes ahead of the server, accepts near-future and past', async () => {
    const f = await buildFixture(u)
    const at = (ms: number) => new Date(Date.now() + ms).toISOString()
    const patch = (ms: number) => u.call('PATCH', `/api/v1/sets/${f.set}`, { done: true, updated_at: at(ms) })
    expect((await patch(10 * 60_000)).status).toBe(400)
    expect((await patch(365 * 24 * 3600_000)).status).toBe(400)
    expect((await patch(60_000)).status).toBe(200)
    expect((await patch(-60_000)).status).toBe(200)
  })
})
