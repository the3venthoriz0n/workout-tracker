import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { OfflineError } from '@workout/shared'
import { toast } from 'sonner'
import { afterEach, expect, test, vi } from 'vitest'
import { routes } from '../src/app/router'
import { AppDb } from '../src/repo/db'
import { LocalRepo } from '../src/repo/local-repo'
import { RepoProvider } from '../src/repo/provider'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

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
  const repo = new LocalRepo(new AppDb(`today-${crypto.randomUUID()}`))
  await repo.init()
  const exercises = await repo.listExercises()
  const ex = exercises.find((e) => e.name === 'Bench Press') ?? exercises[0]!
  const plan = await repo.savePlan({ name: 'Strength' })
  const day = await repo.savePlanDay({ plan_id: plan.id, name: 'Day A' })
  const item = await repo.addPlanItem(day.id, ex.id)
  await repo.updatePlanItem(item.id, { sets: 3, reps: 5, weight: 95 })
  return { repo, plan, ex }
}

type User = ReturnType<typeof userEvent.setup>

async function start(user: User) {
  await user.click(await screen.findByRole('button', { name: 'Start workout' }))
  await screen.findAllByText('5 × 95 lb')
}

const setButtons = () => screen.getAllByRole('button', { name: /^Set \d:/ })

test('start, log all sets, finish shows progression and raises the target', async () => {
  const user = userEvent.setup()
  const { repo, plan, ex } = await seed()
  renderApp(repo)
  await start(user)
  expect(screen.getAllByText('5 × 95 lb')).toHaveLength(3)
  for (const row of setButtons()) await user.click(row)
  await waitFor(() => {
    for (const b of setButtons()) expect(b.getAttribute('aria-pressed')).toBe('true')
  })
  await user.click(screen.getByRole('button', { name: 'Finish workout' }))
  expect(await screen.findByText(new RegExp(`${ex.name}: 95 → 100 lb`))).toBeTruthy()
  const tree = await repo.getPlan(plan.id)
  expect(tree!.days[0]!.items[0]!.effective.targetWeight).toBe(100)
  await user.click(screen.getByRole('button', { name: 'Done' }))
  expect(await screen.findByRole('button', { name: 'Start workout' })).toBeTruthy()
})

test('editing weight with a comma decimal persists', async () => {
  const user = userEvent.setup()
  const { repo } = await seed()
  renderApp(repo)
  await start(user)
  await user.click(screen.getByRole('button', { name: 'Edit set 1' }))
  const w = screen.getByLabelText('Weight')
  await user.clear(w)
  await user.type(w, '62,5')
  await user.tab()
  await waitFor(async () => {
    const s = await repo.getActiveSession()
    expect(s!.exercises[0]!.sets[0]!.weight).toBe(62.5)
  })
  expect(await screen.findByText('5 × 62.5 lb')).toBeTruthy()
})

test('a second app instance resumes the in-progress session', async () => {
  const user = userEvent.setup()
  const { repo } = await seed()
  renderApp(repo)
  await start(user)
  await user.click(screen.getByRole('button', { name: /^Set 1:/ }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /^Set 1:/ }).getAttribute('aria-pressed')).toBe('true'),
  )
  cleanup()
  renderApp(repo)
  const first = await screen.findByRole('button', { name: /^Set 1:/ })
  expect(first.getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByRole('button', { name: /^Set 2:/ }).getAttribute('aria-pressed')).toBe('false')
})

test('a missed set shows missed and keeps the target', async () => {
  const user = userEvent.setup()
  const { repo, plan } = await seed()
  renderApp(repo)
  await start(user)
  await user.click(screen.getByRole('button', { name: /^Set 1:/ }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /^Set 1:/ }).getAttribute('aria-pressed')).toBe('true'),
  )
  await user.click(screen.getByRole('button', { name: 'Finish workout' }))
  expect(await screen.findByText(/missed — stays at 95 lb/)).toBeTruthy()
  const tree = await repo.getPlan(plan.id)
  expect(tree!.days[0]!.items[0]!.effective.targetWeight).toBe(95)
})

test('finishing with nothing done asks first', async () => {
  const user = userEvent.setup()
  const { repo } = await seed()
  renderApp(repo)
  await start(user)
  await user.click(screen.getByRole('button', { name: 'Finish workout' }))
  expect(screen.getByText(/No sets marked done/)).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Finish anyway' }))
  expect(await screen.findByText(/skipped/)).toBeTruthy()
})

test('discard asks for confirmation and returns to the picker', async () => {
  const user = userEvent.setup()
  const { repo } = await seed()
  renderApp(repo)
  await start(user)
  await user.click(screen.getByRole('button', { name: 'Discard' }))
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(setButtons()).toHaveLength(3)
  await user.click(screen.getByRole('button', { name: 'Discard' }))
  await user.click(screen.getByRole('button', { name: 'Yes, discard' }))
  expect(await screen.findByRole('button', { name: 'Start workout' })).toBeTruthy()
  expect(await repo.getActiveSession()).toBeUndefined()
})

test('no plans shows the empty state with a link to plans', async () => {
  const repo = new LocalRepo(new AppDb(`today-${crypto.randomUUID()}`))
  renderApp(repo)
  const link = await screen.findByRole('link', { name: 'Go to plans' })
  expect(link.getAttribute('href')).toBe('/plans')
  expect(screen.queryByRole('button', { name: 'Start workout' })).toBeNull()
})

const pressed = (n: number) =>
  screen.getByRole('button', { name: new RegExp(`^Set ${n}:`) }).getAttribute('aria-pressed')

test('tapping a done row again undoes it, and a fast double tap does not misfire', async () => {
  const user = userEvent.setup()
  const { repo } = await seed()
  renderApp(repo)
  await start(user)
  const row = () => screen.getByRole('button', { name: /^Set 1:/ })
  await user.click(row())
  await waitFor(() => expect(pressed(1)).toBe('true'))
  await user.click(row())
  await waitFor(() => expect(pressed(1)).toBe('false'))
  await user.dblClick(row())
  await waitFor(() => expect(pressed(1)).toBe('true'))
  const s = await repo.getActiveSession()
  expect(s!.exercises[0]!.sets[0]!.done).toBe(true)
})

test('long press survives jitter, cancels on a real move, and swallows the release click', async () => {
  const user = userEvent.setup()
  const { repo } = await seed()
  renderApp(repo)
  await start(user)
  const row = () => screen.getByRole('button', { name: /^Set 1:/ })

  vi.useFakeTimers()
  fireEvent.pointerDown(row(), { clientX: 10, clientY: 10 })
  fireEvent.pointerMove(row(), { clientX: 13, clientY: 10 })
  act(() => {
    vi.advanceTimersByTime(500)
  })
  vi.useRealTimers()
  expect(screen.getByLabelText('Weight')).toBeTruthy()
  fireEvent.pointerUp(row())
  fireEvent.click(row())
  expect(pressed(1)).toBe('false')

  await user.click(screen.getByRole('button', { name: 'Edit set 1' }))
  expect(screen.queryByLabelText('Weight')).toBeNull()

  vi.useFakeTimers()
  fireEvent.pointerDown(row(), { clientX: 10, clientY: 10 })
  fireEvent.pointerMove(row(), { clientX: 30, clientY: 10 })
  act(() => {
    vi.advanceTimersByTime(600)
  })
  vi.useRealTimers()
  expect(screen.queryByLabelText('Weight')).toBeNull()

  await user.click(row())
  await waitFor(() => expect(pressed(1)).toBe('true'))
})

test('a failed toggle toasts and leaves the row unchanged', async () => {
  const user = userEvent.setup()
  const { repo } = await seed()
  renderApp(repo)
  await start(user)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const errSpy = vi.spyOn(toast, 'error')
  vi.spyOn(repo, 'updateSet').mockRejectedValue(new Error('boom'))
  await user.click(screen.getByRole('button', { name: /^Set 1:/ }))
  await waitFor(() => expect(errSpy).toHaveBeenCalledWith("Couldn't save that change"))
  expect(pressed(1)).toBe('false')
})

test('a failed weight edit toasts and reverts the field', async () => {
  const user = userEvent.setup()
  const { repo } = await seed()
  renderApp(repo)
  await start(user)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const errSpy = vi.spyOn(toast, 'error')
  vi.spyOn(repo, 'updateSet').mockRejectedValue(new Error('boom'))
  await user.click(screen.getByRole('button', { name: 'Edit set 1' }))
  const w = screen.getByLabelText('Weight') as HTMLInputElement
  await user.clear(w)
  await user.type(w, '100')
  await user.tab()
  await waitFor(() => expect(errSpy).toHaveBeenCalledWith("Couldn't save that change"))
  await waitFor(() => expect(w.value).toBe('95'))
})

test('invalid edits keep the previous value', async () => {
  const user = userEvent.setup()
  const { repo } = await seed()
  renderApp(repo)
  await start(user)
  await user.click(screen.getByRole('button', { name: 'Edit set 1' }))
  const w = screen.getByLabelText('Weight') as HTMLInputElement
  for (const bad of ['-1', 'abc']) {
    await user.clear(w)
    await user.type(w, bad)
    await user.tab()
    await waitFor(() => expect(w.value).toBe('95'))
  }
  const s = await repo.getActiveSession()
  expect(s!.exercises[0]!.sets[0]!.weight).toBe(95)
})

test('the picker hides plans and days without items', async () => {
  const user = userEvent.setup()
  const { repo, plan } = await seed()
  await repo.savePlanDay({ plan_id: plan.id, name: 'Empty Day' })
  const bare = await repo.savePlan({ name: 'Bare Plan' })
  await repo.savePlanDay({ plan_id: bare.id, name: 'Bare Day' })
  renderApp(repo)
  await screen.findByRole('button', { name: 'Start workout' })
  expect(screen.queryByRole('option', { name: 'Bare Plan' })).toBeNull()
  expect(screen.queryByRole('option', { name: 'Empty Day' })).toBeNull()
  expect(screen.getByRole('option', { name: 'Day A' })).toBeTruthy()
  void user
})

test('a deload shows in the summary', async () => {
  const user = userEvent.setup()
  const { repo, plan, ex } = await seed()
  const item = (await repo.getPlan(plan.id))!.days[0]!.items[0]!
  await repo.updatePlanItem(item.id, { weight: 135 })
  await repo.setRule(item.id, {
    success_action: 'add_weight',
    success_amount: 5,
    fail_streak_limit: 1,
    deload_pct: 10,
    rep_ceiling: null,
  })
  renderApp(repo)
  await screen.findByRole('button', { name: 'Start workout' })
  await user.click(screen.getByRole('button', { name: 'Start workout' }))
  await screen.findAllByText('5 × 135 lb')
  await user.click(screen.getByRole('button', { name: /^Set 1:/ }))
  await waitFor(() => expect(pressed(1)).toBe('true'))
  await user.click(screen.getByRole('button', { name: 'Finish workout' }))
  expect(await screen.findByText(`${ex.name}: deload 135 → 120 lb`)).toBeTruthy()
})

test('starting while a session exists toasts and shows the existing session', async () => {
  const user = userEvent.setup()
  const { repo } = await seed()
  renderApp(repo)
  await screen.findByRole('button', { name: 'Start workout' })
  const errSpy = vi.spyOn(toast, 'error')
  const day = (await repo.listPlans()).length ? (await repo.getPlan((await repo.listPlans())[0]!.id))!.days[0]! : null
  await repo.startSession(day!.id)
  await user.click(screen.getByRole('button', { name: 'Start workout' }))
  await waitFor(() => expect(errSpy).toHaveBeenCalledWith('A workout is already in progress'))
  expect(await screen.findAllByRole('button', { name: /^Set \d:/ })).toHaveLength(3)
})

async function seedWithTargetReps(rule: Parameters<LocalRepo['setRule']>[1], weight: number) {
  const db = new AppDb(`today-${crypto.randomUUID()}`)
  const repo = new LocalRepo(db)
  await repo.init()
  const ex = (await repo.listExercises()).find((e) => e.name === 'Bench Press')!
  const plan = await repo.savePlan({ name: 'Strength' })
  const day = await repo.savePlanDay({ plan_id: plan.id, name: 'Day A' })
  const item = await repo.addPlanItem(day.id, ex.id)
  await repo.updatePlanItem(item.id, { sets: 3, reps: 5, weight })
  await repo.setRule(item.id, rule)
  await db.planItems.update(item.id, { target_reps: 8 })
  return { repo, ex }
}

test('double progression summary shows the reps reset', async () => {
  const user = userEvent.setup()
  const { repo, ex } = await seedWithTargetReps(
    { success_action: 'add_reps', success_amount: 1, fail_streak_limit: 3, deload_pct: 10, rep_ceiling: 8 },
    95,
  )
  renderApp(repo)
  await user.click(await screen.findByRole('button', { name: 'Start workout' }))
  await screen.findAllByText('8 × 95 lb')
  for (const row of setButtons()) await user.click(row)
  await waitFor(() => {
    for (const b of setButtons()) expect(b.getAttribute('aria-pressed')).toBe('true')
  })
  await user.click(screen.getByRole('button', { name: 'Finish workout' }))
  expect(await screen.findByText(`${ex.name}: 95 → 100 lb ✓ · reps 8 → 5`)).toBeTruthy()
})

test('deload summary shows the reps reset', async () => {
  const user = userEvent.setup()
  const { repo, ex } = await seedWithTargetReps(
    { success_action: 'add_weight', success_amount: 5, fail_streak_limit: 1, deload_pct: 10, rep_ceiling: null },
    135,
  )
  renderApp(repo)
  await user.click(await screen.findByRole('button', { name: 'Start workout' }))
  await screen.findAllByText('8 × 135 lb')
  await user.click(screen.getByRole('button', { name: /^Set 1:/ }))
  await waitFor(() => expect(pressed(1)).toBe('true'))
  await user.click(screen.getByRole('button', { name: 'Finish workout' }))
  expect(await screen.findByText(`${ex.name}: deload 135 → 120 lb · reps reset to 5`)).toBeTruthy()
})

test('finishing while offline says to reconnect and keeps the workout', async () => {
  const { repo } = await seed()
  const day = (await repo.getPlan((await repo.listPlans())[0]!.id))!.days[0]!
  await repo.startSession(day.id)
  vi.spyOn(repo, 'finishSession').mockRejectedValue(new OfflineError())
  const err = vi.spyOn(toast, 'error').mockImplementation(() => 'x')
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  renderApp(repo)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: /^Set 1:/ }))
  await user.click(screen.getByRole('button', { name: 'Finish workout' }))
  await waitFor(() => expect(err).toHaveBeenCalledWith(expect.stringMatching(/^Reconnect to finish/)))
  expect(screen.getByRole('button', { name: 'Finish workout' })).toBeTruthy()
})
