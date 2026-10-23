import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { expect, test } from 'vitest'
import { routes } from '../src/app/router'
import { AppDb } from '../src/repo/db'
import { LocalRepo } from '../src/repo/local-repo'
import { RepoProvider } from '../src/repo/provider'

function renderAt(repo: LocalRepo, path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RepoProvider repo={repo}>
        <RouterProvider router={router} />
      </RepoProvider>
    </QueryClientProvider>,
  )
}

async function finishedDay(repo: LocalRepo, dayName: string) {
  const ex = (await repo.listExercises())[0]!
  const plan = await repo.savePlan({ name: 'Plan' })
  const day = await repo.savePlanDay({ plan_id: plan.id, name: dayName })
  const item = await repo.addPlanItem(day.id, ex.id)
  await repo.updatePlanItem(item.id, { sets: 1, reps: 5, weight: 100 })
  const session = await repo.startSession(day.id)
  await repo.updateSet(session.exercises[0]!.sets[0]!.id, { done: true })
  await repo.finishSession(session.id)
  return session.id
}

test('list is newest first and links to the session', async () => {
  const repo = new LocalRepo(new AppDb(`hist-${crypto.randomUUID()}`))
  await repo.init()
  await finishedDay(repo, 'First Day')
  await new Promise((r) => setTimeout(r, 10))
  const secondId = await finishedDay(repo, 'Second Day')

  renderAt(repo, '/history')
  await screen.findByText('Plan · Second Day')
  const links = screen.getAllByRole('link').filter((l) => l.getAttribute('href')?.startsWith('/history/'))
  expect(links).toHaveLength(2)
  expect(links[0]?.textContent).toContain('Second Day')
  expect(links[1]?.textContent).toContain('First Day')
  expect(links[0]?.getAttribute('href')).toBe(`/history/${secondId}`)
  await waitFor(() => expect(screen.getAllByText('1 set done')).toHaveLength(2))
})

test('detail uses the profile unit', async () => {
  const repo = new LocalRepo(new AppDb(`hist-${crypto.randomUUID()}`))
  await repo.init()
  await repo.updateProfile({ units: 'kg' })
  const id = await finishedDay(repo, 'Kg Day')
  renderAt(repo, `/history/${id}`)
  expect(await screen.findByText(/1\. 5 × 100 kg/)).toBeTruthy()
})

test('empty state', async () => {
  const repo = new LocalRepo(new AppDb(`hist-${crypto.randomUUID()}`))
  renderAt(repo, '/history')
  expect(await screen.findByText(/No workouts yet/)).toBeTruthy()
})

test('missing session shows not found', async () => {
  const repo = new LocalRepo(new AppDb(`hist-${crypto.randomUUID()}`))
  renderAt(repo, '/history/nope')
  expect(await screen.findByText('Workout not found.')).toBeTruthy()
})

test('list, detail with done/skipped sets, and name snapshot', async () => {
  const repo = new LocalRepo(new AppDb(`hist-${crypto.randomUUID()}`))
  await repo.init()
  const ex = (await repo.listExercises())[0]!
  const plan = await repo.savePlan({ name: 'Strength A' })
  const day = await repo.savePlanDay({ plan_id: plan.id, name: 'Day One' })
  const item = await repo.addPlanItem(day.id, ex.id)
  await repo.updatePlanItem(item.id, { sets: 3, reps: 5, weight: 62.5 })
  const session = await repo.startSession(day.id)
  const sets = session.exercises[0]!.sets
  await repo.updateSet(sets[0]!.id, { done: true, actual_reps: 5, weight: 62.5 })
  await repo.updateSet(sets[1]!.id, { done: true, actual_reps: 4, weight: 135 })
  await repo.updateSessionNote(session.id, 'felt strong')
  await repo.finishSession(session.id)
  const originalName = ex.name
  await repo.saveExercise({ ...ex, name: 'Renamed Lift' })

  renderAt(repo, '/history')
  expect(await screen.findByText('Strength A · Day One')).toBeTruthy()
  expect(await screen.findByText('2 sets done')).toBeTruthy()
  await userEvent.click(screen.getByRole('link', { name: /Strength A/ }))

  expect(await screen.findByRole('heading', { name: originalName })).toBeTruthy()
  expect(screen.queryByText('Renamed Lift')).toBeNull()
  expect(await screen.findByText(/1\. 5 × 62\.5 lb/)).toBeTruthy()
  expect(screen.getByText(/2\. 4 × 135 lb/)).toBeTruthy()
  expect(screen.getByText(/3\. 5 × 62\.5 lb · skipped/)).toBeTruthy()
  expect(screen.getByText('felt strong')).toBeTruthy()
})

test('detail shows a set note under its line, only when non-empty', async () => {
  const repo = new LocalRepo(new AppDb(`hist-${crypto.randomUUID()}`))
  await repo.init()
  const ex = (await repo.listExercises())[0]!
  const plan = await repo.savePlan({ name: 'Plan' })
  const day = await repo.savePlanDay({ plan_id: plan.id, name: 'Notes Day' })
  const item = await repo.addPlanItem(day.id, ex.id)
  await repo.updatePlanItem(item.id, { sets: 2, reps: 5, weight: 100 })
  const session = await repo.startSession(day.id)
  const sets = session.exercises[0]!.sets
  await repo.updateSet(sets[0]!.id, { done: true, note: 'left shoulder twinge' })
  await repo.updateSet(sets[1]!.id, { done: true })
  await repo.finishSession(session.id)
  renderAt(repo, `/history/${session.id}`)
  const note = await screen.findByText('left shoulder twinge')
  expect(note.closest('li')?.textContent).toContain('1. 5 × 100 lb')
  expect(screen.getAllByRole('listitem').filter((l) => l.querySelector('p'))).toHaveLength(1)
})

test('skipped sets show their planned numbers, muted, with the skipped label', async () => {
  const repo = new LocalRepo(new AppDb(`hist-${crypto.randomUUID()}`))
  await repo.init()
  const ex = (await repo.listExercises())[0]!
  const plan = await repo.savePlan({ name: 'Plan' })
  const day = await repo.savePlanDay({ plan_id: plan.id, name: 'Skip Day' })
  const item = await repo.addPlanItem(day.id, ex.id)
  await repo.updatePlanItem(item.id, { sets: 2, reps: 5, weight: 95 })
  const session = await repo.startSession(day.id)
  await repo.updateSet(session.exercises[0]!.sets[0]!.id, { done: true })
  await repo.finishSession(session.id)
  renderAt(repo, `/history/${session.id}`)
  const skipped = await screen.findByText(/2\. 5 × 95 lb · skipped/)
  expect(skipped.className).toContain('text-muted-foreground')
  expect(screen.getByText(/1\. 5 × 95 lb$/)).toBeTruthy()
})
