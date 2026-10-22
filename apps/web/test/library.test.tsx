import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { expect, test } from 'vitest'
import { routes } from '../src/app/router'
import { AppDb } from '../src/repo/db'
import { LocalRepo } from '../src/repo/local-repo'
import { RepoProvider } from '../src/repo/provider'

function renderLibrary(
  repo = new LocalRepo(new AppDb(`lib-${crypto.randomUUID()}`)),
  path = '/library',
) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RepoProvider repo={repo}>
        <RouterProvider router={router} />
      </RepoProvider>
    </QueryClientProvider>,
  )
  return Object.assign(repo, { router })
}

test('lists seeded exercises and toggling active persists', async () => {
  const user = userEvent.setup()
  const repo = renderLibrary()
  await screen.findAllByRole('switch')
  const first = (await repo.listExercises())[0]!
  const toggle = await screen.findByRole('switch', { name: `${first.name} active` })
  expect(toggle.getAttribute('aria-checked')).toBe('true')
  await user.click(toggle)
  await waitFor(async () => {
    expect((await repo.listExercises()).find((e) => e.id === first.id)?.active).toBe(false)
  })
})

test('creates an exercise through the sheet with a safe video link', async () => {
  const user = userEvent.setup()
  const repo = renderLibrary()
  await user.click(await screen.findByRole('button', { name: /add exercise/i }))
  const dialog = await screen.findByRole('dialog')
  await user.click(within(dialog).getByRole('button', { name: 'Save' }))
  expect(await within(dialog).findByText('Name is required.')).toBeTruthy()

  await user.type(within(dialog).getByLabelText('Name'), 'Zercher Squat')
  await user.type(within(dialog).getByLabelText('Video link'), 'https://example.com/v')
  await user.click(within(dialog).getByRole('button', { name: 'Save' }))

  await waitFor(async () => {
    expect((await repo.listExercises()).some((e) => e.name === 'Zercher Squat')).toBe(true)
  })
  const link = await screen.findByRole('link', { name: 'Video for Zercher Squat' })
  expect(link.getAttribute('target')).toBe('_blank')
  expect(link.getAttribute('rel')).toBe('noopener noreferrer')
})

test('rejects a non-http video link inline', async () => {
  const user = userEvent.setup()
  renderLibrary()
  await user.click(await screen.findByRole('button', { name: /add exercise/i }))
  const dialog = await screen.findByRole('dialog')
  await user.type(within(dialog).getByLabelText('Name'), 'X')
  await user.type(within(dialog).getByLabelText('Video link'), 'javascript:alert(1)')
  await user.click(within(dialog).getByRole('button', { name: 'Save' }))
  expect(await within(dialog).findByText('Enter a valid http(s) link.')).toBeTruthy()
})

const sample = {
  name: 'Zercher Squat',
  notes: '',
  video_url: null,
  required_gear_ids: [],
  active: true,
  default_sets: 3,
  default_reps: 5,
  default_weight: 45,
}

test('deleting an exercise used in a plan shows the in-use message', async () => {
  const user = userEvent.setup()
  const repo = new LocalRepo(new AppDb(`lib-${crypto.randomUUID()}`))
  await repo.init()
  const ex = await repo.saveExercise(sample)
  const plan = await repo.savePlan({ name: 'P' })
  const day = await repo.savePlanDay({ plan_id: plan.id, name: 'D' })
  await repo.addPlanItem(day.id, ex.id)
  renderLibrary(repo)

  await user.click(await screen.findByRole('button', { name: /Zercher Squat/ }))
  const dialog = await screen.findByRole('dialog')
  await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
  await user.click(within(dialog).getByRole('button', { name: 'Confirm delete' }))
  expect(await within(dialog).findByText('Used in a plan. Deactivate it instead.')).toBeTruthy()
  expect((await repo.listExercises()).some((e) => e.id === ex.id)).toBe(true)
})

test('deleting an unused exercise removes it and closes the sheet', async () => {
  const user = userEvent.setup()
  const repo = new LocalRepo(new AppDb(`lib-${crypto.randomUUID()}`))
  await repo.init()
  const ex = await repo.saveExercise(sample)
  renderLibrary(repo)
  await user.click(await screen.findByRole('button', { name: /Zercher Squat/ }))
  const dialog = await screen.findByRole('dialog')
  await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
  await user.click(within(dialog).getByRole('button', { name: 'Confirm delete' }))
  await waitFor(async () => {
    expect((await repo.listExercises()).some((e) => e.id === ex.id)).toBe(false)
  })
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

test('Enter in a number field inside the sheet does not save or close it', async () => {
  const user = userEvent.setup()
  const repo = renderLibrary()
  await user.click(await screen.findByRole('button', { name: /add exercise/i }))
  const dialog = await screen.findByRole('dialog')
  await user.type(within(dialog).getByLabelText('Name'), 'Enter Test')
  const reps = within(dialog).getByLabelText('Reps')
  await user.clear(reps)
  await user.type(reps, '8{Enter}')
  expect(screen.getByRole('dialog')).toBeTruthy()
  expect((await repo.listExercises()).some((e) => e.name === 'Enter Test')).toBe(false)
})

const selected = (name: string) =>
  screen.getByRole('tab', { name }).getAttribute('aria-selected')

test('defaults to Exercises; the Gear tab shows sorted gear and updates the URL', async () => {
  const user = userEvent.setup()
  const repo = renderLibrary()
  await screen.findAllByRole('switch')
  expect(screen.getByRole('tablist', { name: 'Library sections' })).toBeTruthy()
  expect(selected('Exercises')).toBe('true')
  expect(selected('Gear')).toBe('false')
  expect(screen.getByRole('button', { name: /add exercise/i })).toBeTruthy()

  await user.click(screen.getByRole('tab', { name: 'Gear' }))
  expect(selected('Gear')).toBe('true')
  expect(selected('Exercises')).toBe('false')
  expect(repo.router.state.location.search).toBe('?section=gear')
  expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(
    screen.getByRole('tab', { name: 'Gear' }).id,
  )
  expect(screen.queryByRole('button', { name: /add exercise/i })).toBeNull()
  expect(
    screen.getByText('Gear you own decides which exercises appear when you build a plan.'),
  ).toBeTruthy()

  const names = (await repo.listGear()).map((g) => g.name)
  const shown = (await screen.findAllByRole('switch')).map((s) => s.getAttribute('aria-label'))
  expect(shown).toEqual(names)
  expect(shown).toEqual([...shown].sort((a, b) => a!.localeCompare(b!)))

  await user.click(screen.getByRole('tab', { name: 'Exercises' }))
  expect(selected('Exercises')).toBe('true')
  expect(repo.router.state.location.search).toBe('')
})

test('switching sections replaces history and keeps the Library nav highlighted', async () => {
  const user = userEvent.setup()
  const repo = renderLibrary()
  await screen.findAllByRole('switch')
  await user.click(screen.getByRole('tab', { name: 'Gear' }))
  expect(repo.router.state.historyAction).toBe('REPLACE')
  expect(screen.getByRole('link', { name: 'Library' }).getAttribute('aria-current')).toBe('page')
})

test('deep link opens Gear', async () => {
  renderLibrary(undefined, '/library?section=gear')
  expect(await screen.findByLabelText('Custom gear name')).toBeTruthy()
  expect(selected('Gear')).toBe('true')
})

test('unknown section falls back to Exercises', async () => {
  renderLibrary(undefined, '/library?section=bogus')
  expect(await screen.findByRole('button', { name: /add exercise/i })).toBeTruthy()
  expect(selected('Exercises')).toBe('true')
})

test('switching tabs preserves other query params', async () => {
  const user = userEvent.setup()
  const repo = renderLibrary(undefined, '/library?foo=1&section=gear')
  await screen.findByLabelText('Custom gear name')
  await user.click(screen.getByRole('tab', { name: 'Exercises' }))
  expect(repo.router.state.location.search).toBe('?foo=1')
  await user.click(screen.getByRole('tab', { name: 'Gear' }))
  expect(new URLSearchParams(repo.router.state.location.search).get('foo')).toBe('1')
  expect(new URLSearchParams(repo.router.state.location.search).get('section')).toBe('gear')
})

test('gear counts ignore inactive exercises; unused gear shows 0 exercises', async () => {
  const repo = new LocalRepo(new AppDb(`lib-${crypto.randomUUID()}`))
  await repo.init()
  const gear = await repo.saveGear({ name: 'Zebra Sled', owned: true })
  const spare = await repo.saveGear({ name: 'Zebra Spare', owned: true })
  const base = (await repo.listExercises())[0]!
  const { user_id: _u, created_at: _c, updated_at: _up, deleted_at: _d, id: _i, ...input } = base
  await repo.saveExercise({ ...input, name: 'Inactive Sled Pull', required_gear_ids: [gear.id], active: false })
  renderLibrary(repo, '/library?section=gear')
  const sledRow = (await screen.findByRole('switch', { name: 'Zebra Sled' })).closest('li')!
  expect(within(sledRow).getByText('0 exercises')).toBeTruthy()
  const spareRow = screen.getByRole('switch', { name: spare.name }).closest('li')!
  expect(within(spareRow).getByText('0 exercises')).toBeTruthy()
})

test('toggling gear persists and custom gear is added in sorted position', async () => {
  const user = userEvent.setup()
  const repo = renderLibrary(undefined, '/library?section=gear')
  await user.click(await screen.findByRole('switch', { name: 'Barbell' }))
  await waitFor(async () => {
    expect((await repo.listGear()).find((g) => g.name === 'Barbell')?.owned).toBe(false)
  })
  await user.type(screen.getByLabelText('Custom gear name'), 'Aardvark Sled')
  await user.click(screen.getByRole('button', { name: 'Add custom gear' }))
  await waitFor(async () => {
    expect((await repo.listGear()).some((g) => g.name === 'Aardvark Sled' && g.owned)).toBe(true)
  })
  await screen.findByRole('switch', { name: 'Aardvark Sled' })
  const shown = screen.getAllByRole('switch').map((s) => s.getAttribute('aria-label'))
  expect(shown).toEqual((await repo.listGear()).map((g) => g.name))
  expect(shown[0]).toBe('Aardvark Sled')
})

test('each gear row shows how many active exercises require it', async () => {
  const repo = new LocalRepo(new AppDb(`lib-${crypto.randomUUID()}`))
  await repo.init()
  const barbell = (await repo.listGear()).find((g) => g.name === 'Barbell')!
  const exs = await repo.listExercises()
  const expected = exs.filter((e) => e.active && e.required_gear_ids.includes(barbell.id)).length
  expect(expected).toBeGreaterThan(0)
  renderLibrary(repo, '/library?section=gear')
  const row = (await screen.findByRole('switch', { name: 'Barbell' })).closest('li')!
  expect(within(row).getByText(`${expected} ${expected === 1 ? 'exercise' : 'exercises'}`)).toBeTruthy()
})
