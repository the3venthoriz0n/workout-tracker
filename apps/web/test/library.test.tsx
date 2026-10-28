import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { afterEach, expect, test, vi } from 'vitest'
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
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
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
  await user.click(within(dialog).getByRole('button', { name: 'Optional details' }))
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
  await user.click(within(dialog).getByRole('button', { name: 'Optional details' }))
  await user.type(within(dialog).getByLabelText('Video link'), 'javascript:alert(1)')
  await user.click(within(dialog).getByRole('button', { name: 'Save' }))
  expect(await within(dialog).findByText('Enter a valid http(s) link.')).toBeTruthy()
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

test('sheet puts name first, sets/reps/weight in one row, and hides optional details until opened by keyboard', async () => {
  const user = userEvent.setup()
  renderLibrary()
  await user.click(await screen.findByRole('button', { name: /add exercise/i }))
  const dialog = await screen.findByRole('dialog')
  const name = within(dialog).getByLabelText('Name')
  const sets = within(dialog).getByLabelText('Sets')
  const weight = within(dialog).getByLabelText(/^Weight/)
  expect(name.compareDocumentPosition(sets) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(sets.closest('.grid')).toBe(weight.closest('.grid'))
  expect(sets.closest('.grid')!.className).toMatch(/grid-cols-3/)

  const toggle = within(dialog).getByRole('button', { name: 'Optional details' })
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  for (const label of ['Notes', 'Video link']) expect(within(dialog).queryByLabelText(label)).toBeNull()
  expect(within(dialog).queryByText('Required gear')).toBeNull()

  weight.focus()
  await user.tab()
  expect(document.activeElement).toBe(toggle)
  await user.keyboard('{Enter}')
  expect(toggle.getAttribute('aria-expanded')).toBe('true')
  expect(within(dialog).getByLabelText('Notes')).toBeTruthy()
  expect(within(dialog).getByLabelText('Video link')).toBeTruthy()
  expect(within(dialog).getByText('Required gear')).toBeTruthy()
})

test('an invalid video link re-opens the collapsed details', async () => {
  const user = userEvent.setup()
  renderLibrary()
  await user.click(await screen.findByRole('button', { name: /add exercise/i }))
  const dialog = await screen.findByRole('dialog')
  await user.type(within(dialog).getByLabelText('Name'), 'X')
  await user.click(within(dialog).getByRole('button', { name: 'Optional details' }))
  await user.type(within(dialog).getByLabelText('Video link'), 'ftp://nope')
  await user.click(within(dialog).getByRole('button', { name: 'Optional details' }))
  expect(within(dialog).queryByLabelText('Video link')).toBeNull()
  await user.click(within(dialog).getByRole('button', { name: 'Save' }))
  expect(await within(dialog).findByText('Enter a valid http(s) link.')).toBeTruthy()
  expect(within(dialog).getByLabelText('Video link')).toBeTruthy()
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
  expect(screen.getByRole('button', { name: 'Add gear' })).toBeTruthy()
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
  expect(await screen.findByRole('button', { name: 'Add gear' })).toBeTruthy()
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
  await screen.findByRole('button', { name: 'Add gear' })
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
  await user.click(screen.getByRole('button', { name: 'Add gear' }))
  const dialog = await screen.findByRole('dialog')
  await user.type(within(dialog).getByLabelText('Name'), 'Aardvark Sled')
  await user.click(within(dialog).getByRole('button', { name: 'Save' }))
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

async function seeded() {
  const repo = new LocalRepo(new AppDb(`lib-${crypto.randomUUID()}`))
  await repo.init()
  return repo
}

test('one header Add button per section, same place, with a section-specific accessible name', async () => {
  const user = userEvent.setup()
  renderLibrary()
  const heading = await screen.findByRole('heading', { name: 'Library' })
  const adds = screen.getAllByRole('button', { name: /^add/i })
  expect(adds).toHaveLength(1)
  expect(adds[0]!.getAttribute('aria-label')).toBe('Add exercise')
  expect(adds[0]!.textContent?.trim()).toBe('Add')
  expect(heading.parentElement!.contains(adds[0]!)).toBe(true)
  await user.click(screen.getByRole('tab', { name: 'Gear' }))
  const gearAdds = screen.getAllByRole('button', { name: /^add/i })
  expect(gearAdds).toHaveLength(1)
  expect(gearAdds[0]!.getAttribute('aria-label')).toBe('Add gear')
  expect(heading.parentElement!.contains(gearAdds[0]!)).toBe(true)
  expect(screen.queryByLabelText('Custom gear name')).toBeNull()
})

test('Add opens the matching sheet', async () => {
  const user = userEvent.setup()
  renderLibrary()
  await user.click(await screen.findByRole('button', { name: 'Add exercise' }))
  expect(within(await screen.findByRole('dialog')).getByText('Add exercise')).toBeTruthy()
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  await user.click(screen.getByRole('tab', { name: 'Gear' }))
  await user.click(screen.getByRole('button', { name: 'Add gear' }))
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByText('Add gear')).toBeTruthy()
  expect(
    within(dialog).getByRole('switch', { name: 'I own this' }).getAttribute('aria-checked'),
  ).toBe('true')
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
})

test('gear sheet validates the name, creates unowned gear, and Enter does not double-submit', async () => {
  const user = userEvent.setup()
  const repo = renderLibrary(undefined, '/library?section=gear')
  await user.click(await screen.findByRole('button', { name: 'Add gear' }))
  const dialog = await screen.findByRole('dialog')
  await user.click(within(dialog).getByRole('button', { name: 'Save' }))
  expect(await within(dialog).findByText('Name is required.')).toBeTruthy()
  await user.type(within(dialog).getByLabelText('Name'), 'Yoke')
  await user.click(within(dialog).getByRole('switch', { name: 'I own this' }))
  await user.type(within(dialog).getByLabelText('Name'), '{Enter}{Enter}')
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  const yokes = (await repo.listGear()).filter((g) => g.name === 'Yoke')
  expect(yokes).toHaveLength(1)
  expect(yokes[0]!.owned).toBe(false)
})

test('pencil renames gear and changes ownership', async () => {
  const user = userEvent.setup()
  const repo = renderLibrary(undefined, '/library?section=gear')
  await user.click(await screen.findByRole('button', { name: 'Edit Barbell' }))
  const dialog = await screen.findByRole('dialog')
  const name = within(dialog).getByLabelText('Name') as HTMLInputElement
  expect(name.value).toBe('Barbell')
  await user.clear(name)
  await user.type(name, 'Olympic Barbell')
  await user.click(within(dialog).getByRole('switch', { name: 'I own this' }))
  await user.click(within(dialog).getByRole('button', { name: 'Save' }))
  await waitFor(async () => {
    const g = (await repo.listGear()).find((x) => x.name === 'Olympic Barbell')
    expect(g?.owned).toBe(false)
  })
  expect((await repo.listGear()).some((x) => x.name === 'Barbell')).toBe(false)
})

test('pencil edits an exercise pre-filled; the sheet has no delete button', async () => {
  const user = userEvent.setup()
  const repo = renderLibrary(await seeded())
  const first = (await repo.listExercises())[0]!
  await user.click(await screen.findByRole('button', { name: `Edit ${first.name}` }))
  const dialog = await screen.findByRole('dialog')
  expect((within(dialog).getByLabelText('Name') as HTMLInputElement).value).toBe(first.name)
  expect(within(dialog).queryByRole('button', { name: /delete/i })).toBeNull()
})

test('every row in both lists has 44px edit and delete buttons', async () => {
  const user = userEvent.setup()
  renderLibrary()
  const edits = await screen.findAllByRole('button', { name: /^Edit / })
  const deletes = screen.getAllByRole('button', { name: /^Delete / })
  expect(edits.length).toBeGreaterThan(0)
  expect(deletes).toHaveLength(edits.length)
  for (const b of [...edits, ...deletes]) expect(b.className).toContain('size-11')
  await user.click(screen.getByRole('tab', { name: 'Gear' }))
  const gearEdits = await screen.findAllByRole('button', { name: /^Edit / })
  expect(screen.getAllByRole('button', { name: /^Delete / })).toHaveLength(gearEdits.length)
})

test('deleting an exercise used in plans shows the impact, then cascades', async () => {
  const user = userEvent.setup()
  const repo = await seeded()
  const ex = await repo.saveExercise(sample)
  for (const name of ['Plan B', 'Plan A']) {
    const plan = await repo.savePlan({ name })
    const day = await repo.savePlanDay({ plan_id: plan.id, name: 'D' })
    await repo.addPlanItem(day.id, ex.id)
  }
  renderLibrary(repo)
  await user.click(await screen.findByRole('button', { name: 'Delete Zercher Squat' }))
  const confirm = await screen.findByRole('group', { name: 'Confirm delete Zercher Squat' })
  expect(within(confirm).getByText('Delete Zercher Squat?')).toBeTruthy()
  expect(
    await within(confirm).findByText(
      'Used in 2 plan items in: Plan A, Plan B. Deleting also removes it from those plans. Past workouts keep their records.',
    ),
  ).toBeTruthy()
  expect(screen.queryByRole('dialog')).toBeNull()
  await user.click(within(confirm).getByRole('button', { name: 'Delete' }))
  await waitFor(async () => {
    expect((await repo.listExercises()).some((e) => e.id === ex.id)).toBe(false)
  })
  expect((await repo.exerciseUsage(ex.id)).planItemCount).toBe(0)
})

test('deleting an unused exercise says it cannot be undone; Cancel keeps it', async () => {
  const user = userEvent.setup()
  const repo = await seeded()
  const ex = await repo.saveExercise(sample)
  renderLibrary(repo)
  await user.click(await screen.findByRole('button', { name: 'Delete Zercher Squat' }))
  const confirm = await screen.findByRole('group', { name: 'Confirm delete Zercher Squat' })
  expect(await within(confirm).findByText("This can't be undone.")).toBeTruthy()
  await user.click(within(confirm).getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByRole('group', { name: /Confirm delete/ })).toBeNull()
  expect((await repo.listExercises()).some((e) => e.id === ex.id)).toBe(true)
  await user.click(screen.getByRole('button', { name: 'Delete Zercher Squat' }))
  const again = await screen.findByRole('group', { name: /Confirm delete/ })
  await user.click(within(again).getByRole('button', { name: 'Delete' }))
  await waitFor(async () => {
    expect((await repo.listExercises()).some((e) => e.id === ex.id)).toBe(false)
  })
})

test('deleting gear states how many exercises need it and unlinks them', async () => {
  const user = userEvent.setup()
  const repo = await seeded()
  const sled = await repo.saveGear({ name: 'Zebra Sled', owned: true })
  const spare = await repo.saveGear({ name: 'Zebra Spare', owned: true })
  const ex = await repo.saveExercise({ ...sample, required_gear_ids: [sled.id], active: false })
  renderLibrary(repo, '/library?section=gear')
  await user.click(await screen.findByRole('button', { name: 'Delete Zebra Spare' }))
  expect(await screen.findByText("This can't be undone.")).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect((await repo.listGear()).some((g) => g.id === spare.id)).toBe(true)

  await user.click(screen.getByRole('button', { name: 'Delete Zebra Sled' }))
  const confirm = await screen.findByRole('group', { name: 'Confirm delete Zebra Sled' })
  expect(
    within(confirm).getByText(
      '1 exercise needs this gear. It stays in your library but will no longer require it.',
    ),
  ).toBeTruthy()
  await user.click(within(confirm).getByRole('button', { name: 'Delete' }))
  await waitFor(async () => {
    expect((await repo.listGear()).some((g) => g.id === sled.id)).toBe(false)
  })
  const after = (await repo.listExercises()).find((e) => e.id === ex.id)!
  expect(after.required_gear_ids).toEqual([])
})

afterEach(() => vi.restoreAllMocks())

const deleteBtn = (scope: HTMLElement) =>
  within(scope).getByRole('button', { name: 'Delete' }) as HTMLButtonElement

test('gear confirm uses plural grammar for several exercises', async () => {
  const user = userEvent.setup()
  const repo = await seeded()
  const g = await repo.saveGear({ name: 'Zebra Sled', owned: true })
  await repo.saveExercise({ ...sample, name: 'A1', required_gear_ids: [g.id] })
  await repo.saveExercise({ ...sample, name: 'A2', required_gear_ids: [g.id] })
  renderLibrary(repo, '/library?section=gear')
  await user.click(await screen.findByRole('button', { name: 'Delete Zebra Sled' }))
  expect(
    await screen.findByText(
      '2 exercises need this gear. They stay in your library but will no longer require it.',
    ),
  ).toBeTruthy()
})

test('exercise delete fails closed when the usage check errors, and Retry recovers', async () => {
  const user = userEvent.setup()
  const repo = await seeded()
  await repo.saveExercise(sample)
  const spy = vi.spyOn(repo, 'exerciseUsage').mockRejectedValueOnce(new Error('boom'))
  renderLibrary(repo)
  await user.click(await screen.findByRole('button', { name: 'Delete Zercher Squat' }))
  const confirm = await screen.findByRole('group', { name: 'Confirm delete Zercher Squat' })
  expect(
    await within(confirm).findByText(
      "Couldn't check where this exercise is used. It may be in your plans.",
    ),
  ).toBeTruthy()
  expect(deleteBtn(confirm).disabled).toBe(true)
  await user.click(within(confirm).getByRole('button', { name: 'Retry' }))
  expect(await within(confirm).findByText("This can't be undone.")).toBeTruthy()
  expect(deleteBtn(confirm).disabled).toBe(false)
  expect(spy).toHaveBeenCalledTimes(2)
})

test('exercise delete is disabled while the usage check is pending', async () => {
  const user = userEvent.setup()
  const repo = await seeded()
  await repo.saveExercise(sample)
  let release!: (v: { planItemCount: number; plans: string[] }) => void
  vi.spyOn(repo, 'exerciseUsage').mockReturnValue(new Promise((r) => (release = r)))
  renderLibrary(repo)
  await user.click(await screen.findByRole('button', { name: 'Delete Zercher Squat' }))
  const confirm = await screen.findByRole('group', { name: 'Confirm delete Zercher Squat' })
  expect(within(confirm).getByText('Checking where this is used…')).toBeTruthy()
  expect(deleteBtn(confirm).disabled).toBe(true)
  release({ planItemCount: 0, plans: [] })
  await waitFor(() => expect(deleteBtn(confirm).disabled).toBe(false))
})

test('confirm focuses Cancel, Cancel returns focus to the trash button, delete parks focus on the panel', async () => {
  const user = userEvent.setup()
  const repo = await seeded()
  const ex = await repo.saveExercise(sample)
  renderLibrary(repo)
  await user.click(await screen.findByRole('button', { name: 'Delete Zercher Squat' }))
  const confirm = await screen.findByRole('group', { name: 'Confirm delete Zercher Squat' })
  const cancel = within(confirm).getByRole('button', { name: 'Cancel' })
  expect(document.activeElement).toBe(cancel)
  await user.click(cancel)
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete Zercher Squat' })),
  )
  await user.click(screen.getByRole('button', { name: 'Delete Zercher Squat' }))
  const again = await screen.findByRole('group', { name: /Confirm delete/ })
  await waitFor(() => expect(deleteBtn(again).disabled).toBe(false))
  await user.click(deleteBtn(again))
  await waitFor(async () => {
    expect((await repo.listExercises()).some((e) => e.id === ex.id)).toBe(false)
  })
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('tabpanel')))
})

test('two rapid Enters in the exercise sheet create one exercise', async () => {
  const user = userEvent.setup()
  const repo = renderLibrary()
  await user.click(await screen.findByRole('button', { name: 'Add exercise' }))
  const dialog = await screen.findByRole('dialog')
  await user.type(within(dialog).getByLabelText('Name'), 'Double Tap{Enter}{Enter}')
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect((await repo.listExercises()).filter((e) => e.name === 'Double Tap')).toHaveLength(1)
})

test('gear delete fails closed while the exercises query is pending', async () => {
  const user = userEvent.setup()
  const repo = await seeded()
  await repo.saveGear({ name: 'Zebra Sled', owned: true })
  let release!: (v: Awaited<ReturnType<typeof repo.listExercises>>) => void
  vi.spyOn(repo, 'listExercises').mockReturnValue(new Promise((r) => (release = r)))
  renderLibrary(repo, '/library?section=gear')
  await user.click(await screen.findByRole('button', { name: 'Delete Zebra Sled' }))
  const confirm = await screen.findByRole('group', { name: 'Confirm delete Zebra Sled' })
  expect(within(confirm).getByText('Checking which exercises need this gear…')).toBeTruthy()
  expect(deleteBtn(confirm).disabled).toBe(true)
  expect(within(confirm).queryByText(/can't be undone/)).toBeNull()
  const row = screen.getByRole('switch', { name: 'Zebra Sled' }).closest('li')!
  expect(within(row).queryByText(/0 exercises/)).toBeNull()
  release([])
  await waitFor(() => expect(deleteBtn(confirm).disabled).toBe(false))
})

test('gear delete fails closed when the exercises query errors, and Retry recovers', async () => {
  const user = userEvent.setup()
  const repo = await seeded()
  const g = await repo.saveGear({ name: 'Zebra Sled', owned: true })
  await repo.saveExercise({ ...sample, required_gear_ids: [g.id] })
  vi.spyOn(repo, 'listExercises').mockRejectedValue(new Error('boom'))
  renderLibrary(repo, '/library?section=gear')
  await user.click(await screen.findByRole('button', { name: 'Delete Zebra Sled' }))
  const confirm = await screen.findByRole('group', { name: 'Confirm delete Zebra Sled' })
  expect(
    await within(confirm).findByText(
      "Couldn't check which exercises need this gear. Some may depend on it.",
    ),
  ).toBeTruthy()
  expect(deleteBtn(confirm).disabled).toBe(true)
  expect(within(confirm).queryByText(/can't be undone/)).toBeNull()
  const row = screen.getByRole('switch', { name: 'Zebra Sled' }).closest('li')!
  expect(within(row).queryByText(/0 exercises/)).toBeNull()
  vi.restoreAllMocks()
  await user.click(within(confirm).getByRole('button', { name: 'Retry' }))
  expect(
    await within(confirm).findByText(
      '1 exercise needs this gear. It stays in your library but will no longer require it.',
    ),
  ).toBeTruthy()
  expect(deleteBtn(confirm).disabled).toBe(false)
})
