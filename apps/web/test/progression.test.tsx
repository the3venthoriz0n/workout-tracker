import { type RuleInput } from '@workout/shared'
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

// Two items of Back Squat (Push and Legs) and one of Bench Press
async function setup(withPlan = true, prepare?: (repo: LocalRepo, items: string[]) => Promise<void>) {
  const repo = new LocalRepo(new AppDb(`prog-${crypto.randomUUID()}`))
  await repo.init()
  const exercises = await repo.listExercises()
  const squat = exercises.find((e) => e.name === 'Back Squat')!
  const bench = exercises.find((e) => e.name === 'Bench Press')!
  let planId = ''
  const items: string[] = []
  if (withPlan) {
    const plan = await repo.savePlan({ name: 'PPL' })
    planId = plan.id
    const push = await repo.savePlanDay({ plan_id: plan.id, name: 'Push' })
    const legs = await repo.savePlanDay({ plan_id: plan.id, name: 'Legs' })
    items.push((await repo.addPlanItem(push.id, squat.id)).id)
    items.push((await repo.addPlanItem(push.id, bench.id)).id)
    items.push((await repo.addPlanItem(legs.id, squat.id)).id)
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
  return { repo, planId, items, squat, bench }
}

const exerciseRow = (name: string) => screen.findByRole('listitem', { name })
const progressionOf = async (repo: LocalRepo, id: string) =>
  (await repo.listProgressionByExercise()).find((e) => e.exercise_id === id)!

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

test('app default card shows the effective default, persists edits and says it applies live', async () => {
  const user = userEvent.setup()
  const { repo } = await setup(false)
  const heading = await screen.findByText('App default rule')
  const card = within(heading.closest('[data-slot="card"]') as HTMLElement)
  expect(card.getByText(/Used by every exercise without its own default/)).toBeTruthy()
  expect(screen.queryByText(/only affects plan items you add afterwards/)).toBeNull()
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

test('defaults card rejects deload % of 0 and 101 and clears the rep ceiling to null', async () => {
  const user = userEvent.setup()
  const { repo } = await setup(false, async (r) => {
    await r.updateProfile({ default_rule: repsRule })
  })
  const heading = await screen.findByText('App default rule')
  const card = within(heading.closest('[data-slot="card"]') as HTMLElement)
  const deload = card.getByLabelText('Deload %') as HTMLInputElement
  for (const bad of ['0', '101']) {
    await user.clear(deload)
    await user.type(deload, `${bad}{Enter}`)
    await waitFor(() => expect(deload.value).toBe('15'))
    expect((await repo.getProfile()).default_rule?.deload_pct).toBe(15)
  }
  const ceiling = card.getByLabelText('Rep ceiling') as HTMLInputElement
  expect(ceiling.value).toBe('12')
  await user.clear(ceiling)
  await user.tab()
  await waitFor(async () => expect((await repo.getProfile()).default_rule?.rep_ceiling).toBeNull())
})

test('each exercise appears once with its effective rule, its source and how many items inherit', async () => {
  await setup()
  const rows = await screen.findAllByRole('listitem', { name: 'Back Squat' })
  expect(rows).toHaveLength(1)
  const squat = rows[0]!
  expect(within(squat).getByText('+5 lb on success · deload 10% after 3 misses')).toBeTruthy()
  expect(within(squat).getByText('Built-in')).toBeTruthy()
  expect(within(squat).getByText('2 items inherit')).toBeTruthy()
  // Exercises in no plan are listed too
  expect(await exerciseRow('Deadlift')).toBeTruthy()
  expect(within(await exerciseRow('Deadlift')).getByText('Not in any plan')).toBeTruthy()
})

test('the app default shows as the source when set', async () => {
  await setup(true, async (r) => {
    await r.updateProfile({ default_rule: repsRule })
  })
  const squat = await exerciseRow('Back Squat')
  expect(within(squat).getByText('App default')).toBeTruthy()
  expect(within(squat).getByText('Adds 1 rep · up to 12 reps · deload 15% after 2 misses')).toBeTruthy()
})

test('editing the exercise default sets it for inheriting items; Use app default clears it', async () => {
  const user = userEvent.setup()
  const { repo, planId, items, squat: ex } = await setup()
  const squat = await exerciseRow('Back Squat')
  await user.click(within(squat).getByRole('button', { name: 'Edit default for Back Squat' }))
  const limit = within(squat).getByLabelText('Fail streak limit')
  await user.clear(limit)
  await user.type(limit, '5{Enter}')
  await waitFor(async () => expect((await progressionOf(repo, ex.id)).source).toBe('exercise'))
  expect((await repo.listExercises()).find((e) => e.id === ex.id)!.default_rule?.fail_streak_limit).toBe(5)
  // Inheriting plan items follow it at once
  const item = (await repo.getPlan(planId))!.days[0]!.items.find((i) => i.id === items[0])!
  expect(item.ruleSource).toBe('exercise')
  expect(item.rule?.fail_streak_limit).toBe(5)
  await waitFor(() => expect(within(squat).getByText('Exercise default')).toBeTruthy())

  await user.click(within(squat).getByRole('button', { name: 'Use app default for Back Squat' }))
  await waitFor(async () => expect((await progressionOf(repo, ex.id)).source).toBe('builtin'))
  await waitFor(() => expect(within(squat).getByText('Built-in')).toBeTruthy())
})

test('overriding items are listed under the exercise with plan · day and Use default', async () => {
  const user = userEvent.setup()
  const { repo, items, squat: ex } = await setup(true, async (r, ids) => {
    await r.setRule(ids[2]!, repsRule)
  })
  const squat = await exerciseRow('Back Squat')
  expect(within(squat).getByText('1 item inherits')).toBeTruthy()
  const overrides = within(squat).getByRole('list', { name: 'Overrides of Back Squat' })
  expect(within(overrides).getByText('PPL · Legs')).toBeTruthy()
  expect(within(overrides).getByText('Adds 1 rep · up to 12 reps · deload 15% after 2 misses')).toBeTruthy()
  await user.click(within(overrides).getByRole('button', { name: 'Use default for Back Squat in PPL · Legs' }))
  await waitFor(async () => expect((await progressionOf(repo, ex.id)).overrides).toHaveLength(0))
  void items
  await waitFor(() => expect(within(squat).getByText('2 items inherit')).toBeTruthy())
  expect(within(squat).queryByRole('list', { name: 'Overrides of Back Squat' })).toBeNull()
})

test('a no-progression override shows as such', async () => {
  await setup(true, async (r, ids) => {
    await r.setRule(ids[1]!, null)
  })
  const bench = await exerciseRow('Bench Press')
  const overrides = within(bench).getByRole('list', { name: 'Overrides of Bench Press' })
  expect(within(overrides).getByText('No progression')).toBeTruthy()
  expect(within(bench).getByText('No items inherit')).toBeTruthy()
})
