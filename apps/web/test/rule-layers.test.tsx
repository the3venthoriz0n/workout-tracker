import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'
import { freshRepo, renderAt } from './helpers'

async function squatItem() {
  const { repo, byName } = await freshRepo('layers')
  const plan = await repo.savePlan({ name: 'PPL' })
  const day = await repo.savePlanDay({ plan_id: plan.id, name: 'Legs' })
  const item = await repo.addPlanItem(day.id, byName('Back Squat').id)
  const view = async () => (await repo.getPlan(plan.id))!.days[0]!.items[0]!
  return { repo, plan, item, view, squat: byName('Back Squat') }
}

test('an inheriting item shows its effective rule with a Default badge', async () => {
  const { repo, plan } = await squatItem()
  renderAt(repo, `/plans/${plan.id}`)
  const row = await screen.findByRole('listitem', { name: 'Back Squat' })
  expect(within(row).getByText('+5 lb on success · deload 10% after 3 misses')).toBeTruthy()
  expect(within(row).getByText('Default')).toBeTruthy()
  expect(within(row).queryByText('Override')).toBeNull()
})

test('editing a field creates an override; Use default reverts to inheriting', async () => {
  const user = userEvent.setup()
  const { repo, plan, view } = await squatItem()
  renderAt(repo, `/plans/${plan.id}`)
  const row = await screen.findByRole('listitem', { name: 'Back Squat' })
  await user.click(within(row).getByRole('button', { name: 'Progression for Back Squat' }))
  expect(within(row).getByText(/Inherited from the built-in default/)).toBeTruthy()
  expect(within(row).queryByRole('button', { name: 'Use default for Back Squat' })).toBeNull()
  const limit = within(row).getByLabelText('Fail streak limit')
  await user.clear(limit)
  await user.type(limit, '4{Enter}')
  await waitFor(async () => expect((await view()).ruleSource).toBe('item'))
  expect((await view()).rule?.fail_streak_limit).toBe(4)
  await waitFor(() => expect(within(row).getByText('Override')).toBeTruthy())

  await user.click(within(row).getByRole('button', { name: 'Use default for Back Squat' }))
  await waitFor(async () => expect((await view()).ruleSource).toBe('builtin'))
  await waitFor(() => expect(within(row).getByText('Default')).toBeTruthy())
})

test('No progression is an override, and turning it off goes back to inheriting (not a copy)', async () => {
  const user = userEvent.setup()
  const { repo, plan, view, squat } = await squatItem()
  await repo.setExerciseRule(squat.id, {
    success_action: 'add_reps',
    success_amount: 1,
    fail_streak_limit: 2,
    deload_pct: 10,
    rep_ceiling: 8,
  })
  renderAt(repo, `/plans/${plan.id}`)
  const row = await screen.findByRole('listitem', { name: 'Back Squat' })
  expect(within(row).getByText('Default')).toBeTruthy()
  await user.click(within(row).getByRole('button', { name: 'Progression for Back Squat' }))
  expect(within(row).getByText(/Inherited from the exercise default/)).toBeTruthy()
  await user.click(within(row).getByRole('switch', { name: 'No progression for Back Squat' }))
  await waitFor(async () => expect(await view()).toMatchObject({ rule: null, ruleSource: 'item' }))
  await waitFor(() => expect(within(row).getByText('Override')).toBeTruthy())
  await user.click(within(row).getByRole('switch', { name: 'No progression for Back Squat' }))
  await waitFor(async () => expect((await view()).ruleSource).toBe('exercise'))

  // A later change to the exercise default reaches the item: it inherits, it did not copy
  await repo.setExerciseRule(squat.id, null)
  expect((await view()).ruleSource).toBe('builtin')
})
