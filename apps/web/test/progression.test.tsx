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
async function setup(
  withPlan = true,
  prepare?: (repo: LocalRepo, items: string[]) => Promise<void>,
  path = '/library?section=progression',
) {
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
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RepoProvider repo={repo}>
        <RouterProvider router={router} />
      </RepoProvider>
    </QueryClientProvider>,
  )
  return { repo, planId, items, squat, bench }
}

// An exercise's rule lives in its editor: open it from Library and expand Progression
async function openProgression(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole('button', { name: `Edit ${name}` }))
  const dialog = await screen.findByRole('dialog')
  await user.click(await within(dialog).findByRole('button', { name: /^Progression/ }))
  return dialog
}
const progressionOf = async (repo: LocalRepo, id: string) =>
  (await repo.listProgressionByExercise()).find((e) => e.exercise_id === id)!

test('Library has a Progression section with one Default progression card and no separate step', async () => {
  await setup(false)
  expect((await screen.findByRole('tab', { name: 'Progression' })).getAttribute('aria-selected')).toBe('true')
  expect(await screen.findByText('Default progression')).toBeTruthy()
  expect(screen.queryByLabelText('Progression step')).toBeNull()
  expect(screen.getByText(/it adds is your progression step/)).toBeTruthy()
})

test('the Add amount is the progression step: rejects 0 and saves both together', async () => {
  const user = userEvent.setup()
  const { repo } = await setup(false)
  const input = await screen.findByLabelText('Add (lb)')
  await user.clear(input)
  await user.type(input, '0{Enter}')
  await waitFor(() => expect((input as HTMLInputElement).value).toBe('5'))
  expect((await repo.getProfile()).weight_increment).toBe(5)
  await user.clear(input)
  await user.type(input, '2,5{Enter}')
  await waitFor(async () => expect((await repo.getProfile()).weight_increment).toBe(2.5))
  expect((await repo.getProfile()).default_rule?.success_amount).toBe(2.5)
})

test('adding reps leaves the progression step as it was', async () => {
  const user = userEvent.setup()
  const { repo } = await setup(false)
  await user.selectOptions(await screen.findByLabelText('On success'), 'add_reps')
  await waitFor(async () => expect((await repo.getProfile()).default_rule?.success_action).toBe('add_reps'))
  expect((await repo.getProfile()).weight_increment).toBe(5)
})

test('default progression shows the effective default, persists edits and says it applies live', async () => {
  const user = userEvent.setup()
  const { repo } = await setup(false)
  const heading = await screen.findByText('Default progression')
  const card = within(heading.closest('[data-slot="card"]') as HTMLElement)
  expect(card.getByText(/Used by every exercise without its own rule/)).toBeTruthy()
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

test('default progression rejects deload % of 0 and 101 and clears the rep ceiling to null', async () => {
  const user = userEvent.setup()
  const { repo } = await setup(false, async (r) => {
    await r.updateProfile({ default_rule: repsRule })
  })
  const heading = await screen.findByText('Default progression')
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

test('an exercise shows its effective rule and its source', async () => {
  const user = userEvent.setup()
  await setup(true, undefined, '/library')
  const dialog = await openProgression(user, 'Back Squat')
  expect(within(dialog).getByText('+5 lb on success · deload 10% after 3 misses')).toBeTruthy()
  expect(within(dialog).getByText('Built-in')).toBeTruthy()
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

test('the app default shows as the source when set', async () => {
  const user = userEvent.setup()
  await setup(
    true,
    async (r) => {
      await r.updateProfile({ default_rule: repsRule })
    },
    '/library',
  )
  const dialog = await openProgression(user, 'Back Squat')
  expect(within(dialog).getByText('App default')).toBeTruthy()
  expect(within(dialog).getByText('Adds 1 rep · up to 12 reps · deload 15% after 2 misses')).toBeTruthy()
})

test('editing the exercise default sets it for inheriting items; Use app default clears it', async () => {
  const user = userEvent.setup()
  const { repo, planId, items, squat: ex } = await setup(true, undefined, '/library')
  const dialog = await openProgression(user, 'Back Squat')
  const limit = within(dialog).getByLabelText('Fail streak limit')
  await user.clear(limit)
  await user.type(limit, '5{Enter}')
  await waitFor(async () => expect((await progressionOf(repo, ex.id)).source).toBe('exercise'))
  expect((await repo.listExercises()).find((e) => e.id === ex.id)!.default_rule?.fail_streak_limit).toBe(5)
  // Inheriting plan items follow it at once
  const item = (await repo.getPlan(planId))!.days[0]!.items.find((i) => i.id === items[0])!
  expect(item.ruleSource).toBe('exercise')
  expect(item.rule?.fail_streak_limit).toBe(5)
  await waitFor(() => expect(within(dialog).getByText('Exercise default')).toBeTruthy())

  await user.click(within(dialog).getByRole('button', { name: 'Use app default for Back Squat' }))
  await waitFor(async () => expect((await progressionOf(repo, ex.id)).source).toBe('builtin'))
  await waitFor(() => expect(within(dialog).getByText('Built-in')).toBeTruthy())
})

test('overriding items are listed in the exercise with plan · day and Use default', async () => {
  const user = userEvent.setup()
  const { repo, squat: ex } = await setup(
    true,
    async (r, ids) => {
      await r.setRule(ids[2]!, repsRule)
    },
    '/library',
  )
  const dialog = await openProgression(user, 'Back Squat')
  const overrides = within(dialog).getByRole('list', { name: 'Overrides of Back Squat' })
  expect(within(overrides).getByText('PPL · Legs')).toBeTruthy()
  expect(within(overrides).getByText('Adds 1 rep · up to 12 reps · deload 15% after 2 misses')).toBeTruthy()
  await user.click(within(overrides).getByRole('button', { name: 'Use default for Back Squat in PPL · Legs' }))
  await waitFor(async () => expect((await progressionOf(repo, ex.id)).overrides).toHaveLength(0))
  await waitFor(() => expect(within(dialog).queryByRole('list', { name: 'Overrides of Back Squat' })).toBeNull())
})

test('a no-progression override shows as such', async () => {
  const user = userEvent.setup()
  await setup(
    true,
    async (r, ids) => {
      await r.setRule(ids[1]!, null)
    },
    '/library',
  )
  const dialog = await openProgression(user, 'Bench Press')
  const overrides = within(dialog).getByRole('list', { name: 'Overrides of Bench Press' })
  expect(within(overrides).getByText('No progression')).toBeTruthy()
})

test('the Nutrition tab is a placeholder for nutrition tracking', async () => {
  await setup(false, undefined, '/nutrition')
  expect(await screen.findByText('Nutrition tracking is coming soon.')).toBeTruthy()
})

test('the old /progression path opens the Progression section of Library', async () => {
  await setup(false, undefined, '/progression')
  expect((await screen.findByRole('tab', { name: 'Progression' })).getAttribute('aria-selected')).toBe('true')
})
