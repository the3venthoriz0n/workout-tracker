import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { afterEach, expect, test } from 'vitest'
import { routes } from '../src/app/router'
import { lastTimeByExercise } from '../src/lib/last-time'
import { AppDb } from '../src/repo/db'
import { LocalRepo } from '../src/repo/local-repo'
import { RepoProvider } from '../src/repo/provider'

afterEach(cleanup)

function renderApp(repo: LocalRepo) {
  const router = createMemoryRouter(routes, { initialEntries: ['/'] })
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <RepoProvider repo={repo}>
        <RouterProvider router={router} />
      </RepoProvider>
    </QueryClientProvider>,
  )
}

async function seed() {
  const repo = new LocalRepo(new AppDb(`live-${crypto.randomUUID()}`))
  await repo.init()
  const exercises = await repo.listExercises()
  const plan = await repo.savePlan({ name: 'Strength' })
  const day = await repo.savePlanDay({ plan_id: plan.id, name: 'Day A' })
  for (const ex of exercises.slice(0, 2)) {
    const item = await repo.addPlanItem(day.id, ex.id)
    await repo.updatePlanItem(item.id, { sets: 2, reps: 5, weight: 95 })
  }
  return { repo, day }
}

const setButtons = () => screen.getAllByRole('button', { name: /^Set \d:/ })

test('shows set progress, a rest timer after a set, and no rest timer once it is dismissed', async () => {
  const user = userEvent.setup()
  const { repo } = await seed()
  renderApp(repo)
  await user.click(await screen.findByRole('button', { name: 'Start workout' }))
  await screen.findByText(/0 of 4 sets/)
  expect(screen.queryByRole('timer')).toBeNull()
  await user.click(setButtons()[0]!)
  await screen.findByText(/1 of 4 sets/)
  expect(await screen.findByRole('timer')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Dismiss rest timer' }))
  expect(screen.queryByRole('timer')).toBeNull()
})

test("the last session's final done set is shown under the exercise", async () => {
  const user = userEvent.setup()
  const { repo, day } = await seed()
  const first = await repo.startSession(day.id)
  const set = first.exercises[0]!.sets[1]!
  await repo.updateSet(set.id, { done: true, weight: 100, actual_reps: 6 })
  await repo.finishSession(first.id)
  renderApp(repo)
  await user.click(await screen.findByRole('button', { name: 'Start workout' }))
  expect(await screen.findByText('Last time: 6 × 100 lb')).toBeTruthy()
})

test('the weight and reps steppers change the set by the progression step', async () => {
  const user = userEvent.setup()
  const { repo } = await seed()
  const step = (await repo.getProfile()).weight_increment
  renderApp(repo)
  await user.click(await screen.findByRole('button', { name: 'Start workout' }))
  await screen.findAllByRole('button', { name: /^Set \d:/ })
  await user.click(screen.getAllByRole('button', { name: 'Edit set 1' })[0]!)
  await user.click(await screen.findByRole('button', { name: /^More weight by/ }))
  await waitFor(() => expect(screen.getAllByText(`5 × ${95 + step} lb`).length).toBeGreaterThan(0))
  await user.click(screen.getByRole('button', { name: 'More reps' }))
  await waitFor(() => expect(screen.getAllByText(`6 × ${95 + step} lb`).length).toBeGreaterThan(0))
})

test('finish sheet leads with how many lifts progressed and links to History', async () => {
  const user = userEvent.setup()
  const { repo } = await seed()
  renderApp(repo)
  await user.click(await screen.findByRole('button', { name: 'Start workout' }))
  await screen.findAllByRole('button', { name: /^Set \d:/ })
  for (const b of setButtons()) await user.click(b)
  await waitFor(() => expect(setButtons().every((b) => b.getAttribute('aria-pressed') === 'true')).toBe(true))
  await user.click(screen.getByRole('button', { name: 'Finish workout' }))
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByText(/2 of 2 lifts progressed/)).toBeTruthy()
  expect(within(dialog).getByRole('link', { name: /View in History/ })).toBeTruthy()
})

test('lastTimeByExercise skips exercises with nothing done', () => {
  const m = lastTimeByExercise(
    {
      exercises: [
        { exercise_id: 'a', sets: [{ done: false, actual_reps: 5, weight: 100 }] },
        { exercise_id: 'b', sets: [{ done: true, actual_reps: 5, weight: 100 }, { done: true, actual_reps: 4, weight: 102.5 }] },
      ],
    } as never,
    'kg',
  )
  expect(m.has('a')).toBe(false)
  expect(m.get('b')).toBe('4 × 102.5 kg')
})
