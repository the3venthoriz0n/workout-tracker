import type { RuleInput } from '@workout/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { expect, test } from 'vitest'
import { routes } from '../src/app/router'
import { AppDb } from '../src/repo/db'
import { LocalRepo } from '../src/repo/local-repo'
import { RepoProvider } from '../src/repo/provider'

const repsRule: RuleInput = {
  success_action: 'add_reps',
  success_amount: 1,
  fail_streak_limit: 2,
  deload_pct: 15,
  rep_ceiling: 12,
}

async function setup(withPlan = true, prepare?: (repo: LocalRepo, items: string[]) => Promise<void>) {
  const repo = new LocalRepo(new AppDb(`prog-${crypto.randomUUID()}`))
  await repo.init()
  const [ex1, ex2] = await repo.listExercises()
  if (!ex1 || !ex2) throw new Error('seed missing')
  let planId = ''
  const items: string[] = []
  if (withPlan) {
    const plan = await repo.savePlan({ name: 'PPL' })
    planId = plan.id
    const day = await repo.savePlanDay({ plan_id: plan.id, name: 'Push' })
    items.push((await repo.addPlanItem(day.id, ex1.id)).id)
    items.push((await repo.addPlanItem(day.id, ex2.id)).id)
  }
  await prepare?.(repo, items)
  const router = createMemoryRouter(routes, { initialEntries: ['/progression'] })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RepoProvider repo={repo}>
        <RouterProvider router={router} />
      </RepoProvider>
    </QueryClientProvider>,
  )
  return { repo, planId, items }
}

const ruleOf = async (repo: LocalRepo, planId: string, itemId: string) =>
  (await repo.getPlan(planId))?.days[0]?.items.find((i) => i.id === itemId)?.rule

test('shows the title and the progression step with helper text', async () => {
  await setup(false)
  expect(await screen.findByRole('heading', { name: 'Progression' })).toBeTruthy()
  expect(await screen.findByLabelText('Progression step')).toBeTruthy()
  expect(
    screen.getByText(
      'The smallest weight change you can load. Progress steps and deloads snap to it.',
    ),
  ).toBeTruthy()
})

test('step rejects 0 (reverts) and persists a valid value', async () => {
  const user = userEvent.setup()
  const { repo } = await setup(false)
  const input = await screen.findByLabelText('Progression step')
  await user.clear(input)
  await user.type(input, '0')
  await user.tab()
  expect(await screen.findByText('Progression step must be greater than 0.')).toBeTruthy()
  expect((await repo.getProfile()).weight_increment).toBe(5)
  await waitFor(() => expect((input as HTMLInputElement).value).toBe('5'))
  await user.clear(input)
  await user.type(input, '2,5')
  await user.tab()
  await waitFor(async () => expect((await repo.getProfile()).weight_increment).toBe(2.5))
})

test('defaults card shows the effective default, persists edits and notes the scope', async () => {
  const user = userEvent.setup()
  const { repo } = await setup(false)
  const heading = await screen.findByText('Defaults for new plan items')
  const card = within(heading.closest('[data-slot="card"]') as HTMLElement)
  expect(card.getByText(/only affects plan items you add afterwards/)).toBeTruthy()
  expect((card.getByLabelText('Fail streak limit') as HTMLInputElement).value).toBe('3')
  expect((await repo.getProfile()).default_rule).toBeUndefined()
  const limit = card.getByLabelText('Fail streak limit')
  await user.clear(limit)
  await user.type(limit, '2{Enter}')
  await waitFor(async () =>
    expect((await repo.getProfile()).default_rule?.fail_streak_limit).toBe(2),
  )
  await user.selectOptions(card.getByLabelText('On success'), 'add_reps')
  await waitFor(async () =>
    expect((await repo.getProfile()).default_rule).toMatchObject({
      success_action: 'add_reps',
      success_amount: 1,
      fail_streak_limit: 2,
    }),
  )
  const amount = card.getByLabelText('Add (reps)')
  await user.clear(amount)
  await user.type(amount, '0{Enter}')
  await waitFor(() => expect((amount as HTMLInputElement).value).toBe('1'))
  expect((await repo.getProfile()).default_rule?.success_amount).toBe(1)
  expect(card.queryByRole('switch')).toBeNull()
})

test('lists rules grouped by plan and day with one-line summaries', async () => {
  await setup(true, async (repo, items) => {
    await repo.setRule(items[0]!, repsRule)
    await repo.setRule(items[1]!, null)
  })
  expect(await screen.findByRole('heading', { name: 'PPL' })).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Push' })).toBeTruthy()
  expect(
    await screen.findByText('Adds 1 rep · up to 12 reps · deload 15% after 2 misses'),
  ).toBeTruthy()
  expect(screen.getByText('No progression')).toBeTruthy()
})

test('weight rules summarize in the profile unit', async () => {
  await setup()
  const rows = await screen.findAllByRole('listitem')
  expect(rows).toHaveLength(2)
  expect(
    within(rows[0]!).getByText('+5 lb on success · deload 10% after 3 misses'),
  ).toBeTruthy()
})

test('expanding a row edits the rule through the shared editor', async () => {
  const user = userEvent.setup()
  const { repo, planId, items } = await setup()
  const row = (await screen.findAllByRole('listitem'))[0]!
  await user.click(within(row).getByRole('button', { name: /^Edit rule for / }))
  const limit = within(row).getByLabelText('Fail streak limit')
  await user.clear(limit)
  await user.type(limit, '4{Enter}')
  await waitFor(async () => expect((await ruleOf(repo, planId, items[0]!))?.fail_streak_limit).toBe(4))
  expect(await within(row).findByText('+5 lb on success · deload 10% after 4 misses')).toBeTruthy()
})

test('the No progression switch works from the list', async () => {
  const user = userEvent.setup()
  const { repo, planId, items } = await setup()
  const row = (await screen.findAllByRole('listitem'))[0]!
  await user.click(within(row).getByRole('button', { name: /^Edit rule for / }))
  await user.click(within(row).getByRole('switch'))
  await waitFor(async () => expect(await ruleOf(repo, planId, items[0]!)).toBeNull())
  await waitFor(() => expect(within(row).getAllByText('No progression').length).toBeGreaterThan(0))
  await user.click(within(row).getByRole('switch'))
  await waitFor(async () => expect(await ruleOf(repo, planId, items[0]!)).not.toBeNull())
})

test('empty state links to Plans', async () => {
  await setup(false)
  expect(await screen.findByText('No plans yet')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Go to Plans' }).getAttribute('href')).toBe('/plans')
})
