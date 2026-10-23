import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { toast } from 'sonner'
import { afterEach, expect, test, vi } from 'vitest'
import { routes } from '../src/app/router'
import { AppDb } from '../src/repo/db'
import { LocalRepo } from '../src/repo/local-repo'
import { RepoProvider } from '../src/repo/provider'

afterEach(() => vi.restoreAllMocks())

function renderAt(repo: LocalRepo, path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RepoProvider repo={repo}>
        <RouterProvider router={router} />
      </RepoProvider>
    </QueryClientProvider>,
  )
  return router
}

async function setup(finish = true) {
  const repo = new LocalRepo(new AppDb(`hist-edit-${crypto.randomUUID()}`))
  await repo.init()
  const ex = (await repo.listExercises())[0]!
  const plan = await repo.savePlan({ name: 'Plan' })
  const day = await repo.savePlanDay({ plan_id: plan.id, name: 'Day' })
  const item = await repo.addPlanItem(day.id, ex.id)
  await repo.updatePlanItem(item.id, { sets: 2, reps: 5, weight: 100 })
  const session = await repo.startSession(day.id)
  await repo.updateSet(session.exercises[0]!.sets[0]!.id, { done: true })
  if (finish) await repo.finishSession(session.id)
  const sets = session.exercises[0]!.sets
  return { repo, ex, session, sets }
}

async function openEditor(n: number, exName: string) {
  await userEvent.click(await screen.findByRole('button', { name: 'Edit workout' }))
  await userEvent.click(screen.getByRole('button', { name: `Edit set ${n} of ${exName}` }))
}

test('helper line and set edit controls only show in edit mode', async () => {
  const { repo, ex, session } = await setup()
  renderAt(repo, `/history/${session.id}`)
  const edit = await screen.findByRole('button', { name: 'Edit workout' })
  expect(edit.className).toContain('min-h-11')
  expect(screen.queryByText(/doesn't change your plan targets/)).toBeNull()
  expect(screen.queryByRole('button', { name: /Edit set/ })).toBeNull()
  await userEvent.click(edit)
  expect(screen.getByText(/doesn't change your plan targets or progression/)).toBeTruthy()
  expect(screen.getByRole('button', { name: `Edit set 1 of ${ex.name}` })).toBeTruthy()
  await userEvent.click(screen.getByRole('button', { name: 'Edit workout' }))
  expect(screen.queryByText(/doesn't change your plan targets/)).toBeNull()
  expect(screen.queryByRole('button', { name: /Edit set/ })).toBeNull()
})

test('edit reps and weight persist, including zero', async () => {
  const { repo, ex, session } = await setup()
  renderAt(repo, `/history/${session.id}`)
  await openEditor(1, ex.name)
  const reps = screen.getByLabelText('Reps')
  await userEvent.clear(reps)
  await userEvent.type(reps, '0{Enter}')
  const weight = screen.getByLabelText('Weight')
  await userEvent.clear(weight)
  await userEvent.type(weight, '0{Enter}')
  await waitFor(async () => {
    const s = (await repo.getSession(session.id))!.exercises[0]!.sets[0]!
    expect(s.actual_reps).toBe(0)
    expect(s.weight).toBe(0)
  })
  expect(await screen.findByText(/1\. 0 × 0 lb/)).toBeTruthy()
  await userEvent.clear(weight)
  await userEvent.type(weight, '102.5{Enter}')
  await waitFor(async () => {
    expect((await repo.getSession(session.id))!.exercises[0]!.sets[0]!.weight).toBe(102.5)
  })
})

test('rejected input reverts and does not save', async () => {
  const { repo, ex, session } = await setup()
  const spy = vi.spyOn(repo, 'updateSet')
  renderAt(repo, `/history/${session.id}`)
  await openEditor(1, ex.name)
  const reps = screen.getByLabelText('Reps') as HTMLInputElement
  await userEvent.clear(reps)
  await userEvent.type(reps, '-3{Enter}')
  await waitFor(() => expect(reps.value).toBe('5'))
  await userEvent.clear(reps)
  await userEvent.type(reps, 'abc{Enter}')
  await waitFor(() => expect(reps.value).toBe('5'))
  expect(spy).not.toHaveBeenCalled()
})

test('toggling done and skipped updates the display and the list count', async () => {
  const { repo, ex, session } = await setup()
  const router = renderAt(repo, `/history/${session.id}`)
  await openEditor(2, ex.name)
  const toggle = screen.getByRole('button', { name: 'Counted as done' })
  expect(toggle.getAttribute('aria-pressed')).toBe('false')
  expect(screen.getByText(/2\. 5 × 100 lb · skipped/)).toBeTruthy()
  await userEvent.click(toggle)
  await waitFor(() => expect(toggle.getAttribute('aria-pressed')).toBe('true'))
  expect(screen.queryByText(/skipped/)).toBeNull()
  expect((await repo.getSession(session.id))!.exercises[0]!.sets[1]!.done).toBe(true)
  await userEvent.click(screen.getByRole('button', { name: 'Edit workout' }))
  await router.navigate('/history')
  expect(await screen.findByText('2 sets done')).toBeTruthy()
})

test('list count drops when a set is marked skipped', async () => {
  const { repo, ex, session } = await setup()
  const router = renderAt(repo, `/history/${session.id}`)
  await openEditor(1, ex.name)
  await userEvent.click(screen.getByRole('button', { name: 'Counted as done' }))
  await waitFor(() => expect(screen.getAllByText(/skipped/)).toHaveLength(2))
  await router.navigate('/history')
  expect(await screen.findByText('0 sets done')).toBeTruthy()
})

test('edit a set note and the session note', async () => {
  const { repo, ex, session } = await setup()
  renderAt(repo, `/history/${session.id}`)
  await openEditor(1, ex.name)
  const note = screen.getByLabelText('Note for set 1')
  await userEvent.type(note, 'tweaky elbow{Enter}')
  await waitFor(async () => {
    expect((await repo.getSession(session.id))!.exercises[0]!.sets[0]!.note).toBe('tweaky elbow')
  })
  const sessionNote = screen.getByRole('textbox', { name: 'Note' })
  await userEvent.type(sessionNote, 'good day')
  await userEvent.tab()
  await waitFor(async () => expect((await repo.getSession(session.id))!.note).toBe('good day'))
  await userEvent.click(screen.getByRole('button', { name: 'Edit workout' }))
  expect(await screen.findByText('good day')).toBeTruthy()
})

test('a failing save reverts and toasts', async () => {
  const { repo, ex, session } = await setup()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const errSpy = vi.spyOn(toast, 'error')
  vi.spyOn(repo, 'updateSet').mockRejectedValue(new Error('boom'))
  renderAt(repo, `/history/${session.id}`)
  await openEditor(1, ex.name)
  const weight = screen.getByLabelText('Weight') as HTMLInputElement
  await userEvent.clear(weight)
  await userEvent.type(weight, '300{Enter}')
  await waitFor(() => expect(errSpy).toHaveBeenCalled())
  await waitFor(() => expect(weight.value).toBe('100'))
  expect(screen.getByText(/1\. 5 × 100 lb/)).toBeTruthy()
})

test('only one set editor is open at a time', async () => {
  const { repo, ex, session } = await setup()
  renderAt(repo, `/history/${session.id}`)
  await openEditor(1, ex.name)
  await userEvent.click(screen.getByRole('button', { name: `Edit set 2 of ${ex.name}` }))
  expect(screen.getAllByLabelText('Reps')).toHaveLength(1)
  expect(screen.getByLabelText('Note for set 2')).toBeTruthy()
})

test('names stay snapshotted after renaming the exercise', async () => {
  const { repo, ex, session } = await setup()
  await repo.saveExercise({ ...ex, name: 'Renamed Lift' })
  renderAt(repo, `/history/${session.id}`)
  await openEditor(1, ex.name)
  expect(screen.queryByText('Renamed Lift')).toBeNull()
})

test('an in-progress session has no Edit button', async () => {
  const { repo, session } = await setup(false)
  renderAt(repo, `/history/${session.id}`)
  await screen.findByText('Plan · Day')
  expect(screen.queryByRole('button', { name: 'Edit workout' })).toBeNull()
})

test('leaving edit mode closes an open editor and hides the controls', async () => {
  const { repo, ex, session } = await setup()
  renderAt(repo, `/history/${session.id}`)
  await openEditor(1, ex.name)
  expect(screen.getByLabelText('Reps')).toBeTruthy()
  await userEvent.click(screen.getByRole('button', { name: 'Edit workout' }))
  expect(screen.queryByLabelText('Reps')).toBeNull()
  expect(screen.queryByRole('button', { name: /Edit set/ })).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Edit workout' }))
  expect(screen.queryByLabelText('Reps')).toBeNull()
})

test('opening a set editor focuses its reps field', async () => {
  const { repo, ex, session } = await setup()
  renderAt(repo, `/history/${session.id}`)
  await openEditor(1, ex.name)
  expect(document.activeElement).toBe(screen.getByLabelText('Reps'))
})

test('a trailing space in the set note is trimmed in the field', async () => {
  const { repo, ex, session } = await setup()
  renderAt(repo, `/history/${session.id}`)
  await openEditor(1, ex.name)
  const note = screen.getByLabelText('Note for set 1') as HTMLInputElement
  await userEvent.type(note, 'tight ')
  await userEvent.tab()
  await waitFor(() => expect(note.value).toBe('tight'))
})
