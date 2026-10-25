import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'
import { freshRepo, renderAt } from './helpers'

async function benchDay(opts: { angle?: boolean } = {}) {
  const { repo, byName } = await freshRepo('angle')
  const bench = byName('Bench Press')
  if (opts.angle) await repo.saveExercise({ ...bench, supports_angle: true })
  const plan = await repo.savePlan({ name: 'Strength' })
  const day = await repo.savePlanDay({ plan_id: plan.id, name: 'Day A' })
  const item = await repo.addPlanItem(day.id, bench.id)
  await repo.updatePlanItem(item.id, { sets: 3, reps: 5, weight: 95 })
  const stored = async () => (await repo.getPlan(plan.id))!.days[0]!.items[0]!
  return { repo, plan, day, item, bench, stored }
}

test('exercise sheet: the Has angle switch saves supports_angle', async () => {
  const user = userEvent.setup()
  const { repo, byName } = await freshRepo('angle-sheet')
  renderAt(repo, '/library')
  await user.click(await screen.findByRole('button', { name: 'Edit Bench Press' }))
  const dialog = await screen.findByRole('dialog')
  const sw = within(dialog).getByRole('switch', { name: 'Has angle (flat / incline / decline)' })
  expect(sw.getAttribute('aria-checked')).toBe('false')
  await user.click(sw)
  await user.click(within(dialog).getByRole('button', { name: 'Save' }))
  await waitFor(async () =>
    expect((await repo.listExercises()).find((e) => e.id === byName('Bench Press').id)!.supports_angle).toBe(true),
  )
})

test('plan item: no angle control unless the exercise supports it', async () => {
  const { repo, plan } = await benchDay()
  renderAt(repo, `/plans/${plan.id}`)
  const row = await screen.findByRole('listitem', { name: 'Bench Press' })
  expect(within(row).queryByRole('group', { name: 'Angle for Bench Press' })).toBeNull()
})

test('plan item: the Flat | Incline | Decline control sets, shows and clears the angle', async () => {
  const user = userEvent.setup()
  const { repo, plan, stored } = await benchDay({ angle: true })
  renderAt(repo, `/plans/${plan.id}`)
  const row = await screen.findByRole('listitem', { name: 'Bench Press' })
  const group = within(row).getByRole('group', { name: 'Angle for Bench Press' })
  expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['Flat', 'Incline', 'Decline'])
  await user.click(within(group).getByRole('button', { name: 'Incline' }))
  await waitFor(async () => expect((await stored()).angle).toBe('incline'))
  await waitFor(() =>
    expect(within(group).getByRole('button', { name: 'Incline' }).getAttribute('aria-pressed')).toBe('true'),
  )
  expect(within(row).getByText('Incline', { selector: '[data-slot="angle-chip"]' })).toBeTruthy()
  // Tapping the selected angle again unsets it (angle is optional)
  await user.click(within(group).getByRole('button', { name: 'Incline' }))
  await waitFor(async () => expect((await stored()).angle).toBeNull())
  await waitFor(() => expect(row.querySelector('[data-slot="angle-chip"]')).toBeNull())
})

test('angle chip on Today, the finish summary and history', async () => {
  const user = userEvent.setup()
  const { repo, item } = await benchDay({ angle: true })
  await repo.updatePlanItem(item.id, { angle: 'decline' })
  renderAt(repo, '/')
  await user.click(await screen.findByRole('button', { name: 'Start workout' }))
  const heading = await screen.findByRole('heading', { level: 2, name: 'Bench Press · Decline' })
  expect(heading).toBeTruthy()
  for (const b of screen.getAllByRole('button', { name: /^Set \d:/ })) await user.click(b)
  await waitFor(() =>
    expect(screen.getAllByRole('button', { name: /^Set \d:/ }).every((b) => b.getAttribute('aria-pressed') === 'true')).toBe(true),
  )
  await user.click(screen.getByRole('button', { name: 'Finish workout' }))
  expect(await screen.findByText('Bench Press · Decline: 95 → 100 lb ✓')).toBeTruthy()

  const [session] = await repo.listSessions()
  renderAt(repo, `/history/${session!.id}`)
  expect(await screen.findByRole('heading', { level: 2, name: 'Bench Press · Decline' })).toBeTruthy()
})

test('plan item: the AMRAP switch has helper text and saves amrap_last', async () => {
  const user = userEvent.setup()
  const { repo, plan, stored } = await benchDay()
  renderAt(repo, `/plans/${plan.id}`)
  const row = await screen.findByRole('listitem', { name: 'Bench Press' })
  const sw = within(row).getByRole('switch', { name: 'Last set is AMRAP' })
  expect(within(row).getByText('Target reps is the minimum. Log what you actually did.')).toBeTruthy()
  expect(sw.getAttribute('aria-describedby')).toBeTruthy()
  await user.click(sw)
  await waitFor(async () => expect((await stored()).amrap_last).toBe(true))
})

test('Today: the AMRAP set shows 5+, and marking it done opens its reps editor without blocking the toggle', async () => {
  const user = userEvent.setup()
  const { repo, item } = await benchDay()
  await repo.updatePlanItem(item.id, { amrap_last: true })
  renderAt(repo, '/')
  await user.click(await screen.findByRole('button', { name: 'Start workout' }))
  const rows = await screen.findAllByRole('button', { name: /^Set \d:/ })
  expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual([
    'Set 1: 5 × 95 lb',
    'Set 2: 5 × 95 lb',
    'Set 3: 5+ × 95 lb, AMRAP',
  ])
  expect(within(rows[2]!).getByText('AMRAP')).toBeTruthy()
  expect(within(rows[2]!).getByText('5+ × 95 lb')).toBeTruthy()

  // Plain sets do not open the editor
  await user.click(rows[0]!)
  await waitFor(() => expect(rows[0]!.getAttribute('aria-pressed')).toBe('true'))
  expect(screen.queryByLabelText('Reps')).toBeNull()

  await user.click(rows[2]!)
  await waitFor(() => expect(screen.getByRole('button', { name: /^Set 3:/ }).getAttribute('aria-pressed')).toBe('true'))
  const reps = await screen.findByLabelText('Reps')
  await waitFor(() => expect(document.activeElement).toBe(reps))
  await user.clear(reps)
  await user.type(reps, '9{Enter}')
  await waitFor(() => expect(screen.getByRole('button', { name: /^Set 3:/ }).getAttribute('aria-label')).toBe('Set 3: 9 × 95 lb, AMRAP'))
  const session = (await repo.getActiveSession())!
  expect(session.exercises[0]!.sets[2]!).toMatchObject({ actual_reps: 9, done: true, amrap: true })
})

test('history shows the extra AMRAP reps', async () => {
  const { repo, day, item } = await benchDay()
  await repo.updatePlanItem(item.id, { amrap_last: true })
  const s = await repo.startSession(day.id)
  const sets = s.exercises[0]!.sets
  for (const set of sets) await repo.updateSet(set.id, { done: true })
  await repo.updateSet(sets[2]!.id, { actual_reps: 8 })
  await repo.finishSession(s.id)
  renderAt(repo, `/history/${s.id}`)
  expect(await screen.findByText(/3\. 8 × 95 lb/)).toBeTruthy()
  expect(screen.getByText('AMRAP +3')).toBeTruthy()
})
