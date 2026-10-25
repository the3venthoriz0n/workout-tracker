import { ConflictError, ValidationError } from '@workout/shared'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { afterEach, expect, test, vi } from 'vitest'
import { freshRepo, renderAt } from './helpers'

afterEach(() => vi.restoreAllMocks())

async function pushDay() {
  const { repo, byName } = await freshRepo('ss')
  const plan = await repo.savePlan({ name: 'PPL' })
  const day = await repo.savePlanDay({ plan_id: plan.id, name: 'Push' })
  const ids: string[] = []
  for (const n of ['Bench Press', 'Barbell Row', 'Overhead Press']) {
    const item = await repo.addPlanItem(day.id, byName(n).id)
    await repo.updatePlanItem(item.id, { sets: 2, reps: 5, weight: 50 })
    ids.push(item.id)
  }
  const items = async () => (await repo.getPlan(plan.id))!.days[0]!.items
  return { repo, plan, day, ids, items, byName }
}

test('links two items of a day into a superset and unlinks it again', async () => {
  const user = userEvent.setup()
  const { repo, plan, items } = await pushDay()
  renderAt(repo, `/plans/${plan.id}`)
  const region = await screen.findByRole('region', { name: 'Day Push' })
  await user.click(within(region).getByRole('button', { name: 'Link superset in Push' }))
  const picker = within(region).getByRole('group', { name: 'Pick 2-3 exercises to link' })
  const link = within(picker).getByRole('button', { name: /^Link as superset/ })
  expect((link as HTMLButtonElement).disabled).toBe(true)
  await user.click(within(picker).getByRole('checkbox', { name: 'Bench Press' }))
  await user.click(within(picker).getByRole('checkbox', { name: 'Overhead Press' }))
  expect((link as HTMLButtonElement).disabled).toBe(false)
  await user.click(link)

  await waitFor(async () => {
    const [a, b, c] = await items()
    expect(a!.superset_group).not.toBeNull()
    expect(c!.superset_group).toBe(a!.superset_group)
    expect(b!.superset_group).toBeNull()
  })
  const block = await within(region).findByRole('group', { name: 'Superset A' })
  const members = within(block).getAllByRole('listitem')
  expect(members.map((m) => m.getAttribute('aria-label'))).toEqual(['Bench Press', 'Overhead Press'])
  expect(within(members[0]!).getByText('A1')).toBeTruthy()
  expect(within(members[1]!).getByText('A2')).toBeTruthy()

  await user.click(within(block).getByRole('button', { name: 'Unlink superset A' }))
  await waitFor(async () => expect((await items()).every((i) => i.superset_group === null)).toBe(true))
  await waitFor(() => expect(within(region).queryByRole('group', { name: 'Superset A' })).toBeNull())
})

test('at most three items can be picked', async () => {
  const user = userEvent.setup()
  const { repo, plan, day, byName } = await pushDay()
  await repo.addPlanItem(day.id, byName('Deadlift').id)
  renderAt(repo, `/plans/${plan.id}`)
  const region = await screen.findByRole('region', { name: 'Day Push' })
  await user.click(within(region).getByRole('button', { name: 'Link superset in Push' }))
  const picker = within(region).getByRole('group', { name: 'Pick 2-3 exercises to link' })
  for (const n of ['Bench Press', 'Barbell Row', 'Overhead Press'])
    await user.click(within(picker).getByRole('checkbox', { name: n }))
  expect((within(picker).getByRole('checkbox', { name: 'Deadlift' }) as HTMLInputElement).disabled).toBe(true)
  await user.click(within(picker).getByRole('button', { name: 'Cancel' }))
  expect(within(region).queryByRole('group', { name: 'Pick 2-3 exercises to link' })).toBeNull()
})

test('a ValidationError or ConflictError from setSuperset shows a toast', async () => {
  const user = userEvent.setup()
  const { repo, plan } = await pushDay()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const err = vi.spyOn(toast, 'error')
  const spy = vi
    .spyOn(repo, 'setSuperset')
    .mockRejectedValueOnce(new ValidationError('itemIds', 'A superset needs 2-3 items of the same day'))
    .mockRejectedValueOnce(new ConflictError('group in use'))
  renderAt(repo, `/plans/${plan.id}`)
  const region = await screen.findByRole('region', { name: 'Day Push' })
  for (let i = 0; i < 2; i++) {
    if (!within(region).queryByRole('group', { name: 'Pick 2-3 exercises to link' }))
      await user.click(within(region).getByRole('button', { name: 'Link superset in Push' }))
    const picker = within(region).getByRole('group', { name: 'Pick 2-3 exercises to link' })
    const boxes = within(picker).getAllByRole('checkbox') as HTMLInputElement[]
    if (!boxes[0]!.checked) await user.click(boxes[0]!)
    if (!boxes[1]!.checked) await user.click(boxes[1]!)
    await user.click(within(picker).getByRole('button', { name: /^Link as superset/ }))
  }
  await waitFor(() => expect(spy).toHaveBeenCalledTimes(2))
  expect(spy.mock.calls[0]![0]).toBe((await repo.getPlan(plan.id))!.days[0]!.id)
  await waitFor(() => expect(err).toHaveBeenCalledWith('A superset needs 2-3 items of the same day'))
  await waitFor(() =>
    expect(err).toHaveBeenCalledWith('This superset changed somewhere else. Reload and try again.'),
  )
})

test('Today renders a superset as one block with sets interleaved in seq order', async () => {
  const { repo, day, ids } = await pushDay()
  await repo.setSuperset(day.id, crypto.randomUUID(), [ids[0]!, ids[1]!])
  renderAt(repo, '/')
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Start workout' }))
  const block = await screen.findByRole('region', { name: 'Superset A' })
  expect(within(block).getByText('Superset')).toBeTruthy()
  const sets = within(block).getAllByRole('button', { name: /^Set \d:/ })
  expect(sets.map((b) => b.getAttribute('aria-label'))).toEqual([
    'Set 1: 5 × 50 lb, A1 Bench Press',
    'Set 1: 5 × 50 lb, A2 Barbell Row',
    'Set 2: 5 × 50 lb, A1 Bench Press',
    'Set 2: 5 × 50 lb, A2 Barbell Row',
  ])
  // The third exercise is a normal block after the superset
  expect(screen.getByRole('heading', { level: 2, name: 'Overhead Press' })).toBeTruthy()
})

test('history detail shows the superset block interleaved too', async () => {
  const { repo, day, ids } = await pushDay()
  await repo.setSuperset(day.id, crypto.randomUUID(), [ids[0]!, ids[1]!])
  const s = await repo.startSession(day.id)
  await repo.finishSession(s.id)
  renderAt(repo, `/history/${s.id}`)
  const block = await screen.findByRole('region', { name: 'Superset A' })
  const lines = within(block)
    .getAllByRole('listitem')
    .map((li) => li.textContent?.replace(/\s+/g, ' ').trim())
  expect(lines).toEqual([
    'A1 Bench Press 1. 5 × 50 lb · skipped',
    'A2 Barbell Row 1. 5 × 50 lb · skipped',
    'A1 Bench Press 2. 5 × 50 lb · skipped',
    'A2 Barbell Row 2. 5 × 50 lb · skipped',
  ])
})
