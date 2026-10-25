import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { toast } from 'sonner'
import { afterEach, expect, test, vi } from 'vitest'
import { routes } from '../src/app/router'
import { AppDb } from '../src/repo/db'
import { LocalRepo } from '../src/repo/local-repo'
import { RepoProvider } from '../src/repo/provider'

afterEach(() => {
  vi.restoreAllMocks()
})

async function setup(path?: string) {
  const repo = new LocalRepo(new AppDb(`pd-${crypto.randomUUID()}`))
  await repo.init()
  const plan = await repo.savePlan({ name: 'Starter' })
  const exercises = await repo.listExercises()
  const byName = (n: string) => exercises.find((e) => e.name === n)!
  const router = createMemoryRouter(routes, { initialEntries: [path ?? `/plans/${plan.id}`] })
  const view = () =>
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RepoProvider repo={repo}>
          <RouterProvider router={router} />
        </RepoProvider>
      </QueryClientProvider>,
    )
  return { repo, plan, byName, view, router }
}

const itemRow = (name: string) => screen.getByRole('listitem', { name })

test('builds a plan through the UI and overrides reps with fallback to the default', async () => {
  const user = userEvent.setup()
  const { repo, plan, view } = await setup('/plans')
  void plan
  view()
  await user.type(await screen.findByLabelText('New plan name'), 'Fresh{Enter}')
  await user.click(await screen.findByRole('link', { name: /Fresh/ }))
  await user.click(await screen.findByRole('button', { name: 'Add day' }))
  await screen.findByLabelText('Day name')
  await user.click(screen.getByRole('button', { name: /Add exercise to Day A/ }))
  const dialog = await screen.findByRole('dialog')
  await user.click(await within(dialog).findByRole('button', { name: 'Bench Press' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

  const row = await screen.findByRole('listitem', { name: 'Bench Press' })
  expect(within(row).getByText('Next: 3×5 @ 95 lb')).toBeTruthy()
  const reps = within(row).getByLabelText('Reps') as HTMLInputElement
  expect(reps.placeholder).toBe('5')

  await user.type(reps, '8{Enter}')
  await waitFor(() => expect(within(itemRow('Bench Press')).getByText('Next: 3×8 @ 95 lb')).toBeTruthy())
  const stored = (await repo.getPlan((await repo.listPlans()).find((p) => p.name === 'Fresh')!.id))!.days[0]!.items[0]!
  expect(stored.reps).toBe(8)

  await user.clear(within(itemRow('Bench Press')).getByLabelText('Reps'))
  await user.tab()
  await waitFor(() => expect(within(itemRow('Bench Press')).getByText('Next: 3×5 @ 95 lb')).toBeTruthy())
  const cleared = (await repo.getPlan((await repo.listPlans()).find((p) => p.name === 'Fresh')!.id))!
  expect(cleared.days[0]!.items[0]!.reps).toBeNull()
})

test('picker hides exercises whose gear is not owned, but the plan keeps them', async () => {
  const user = userEvent.setup()
  const { repo, plan, byName, view } = await setup()
  const day = await repo.savePlanDay({ plan_id: plan.id, name: 'Day A' })
  await repo.addPlanItem(day.id, byName('Bench Press').id)
  const bench = byName('Bench Press')
  const gearId = bench.required_gear_ids[0]!
  const gear = (await repo.listGear()).find((g) => g.id === gearId)!
  await repo.saveGear({ id: gear.id, name: gear.name, owned: false })

  view()
  expect(await screen.findByRole('listitem', { name: 'Bench Press' })).toBeTruthy()
  await user.click(screen.getByRole('button', { name: /Add exercise to Day A/ }))
  const dialog = await screen.findByRole('dialog')
  await within(dialog).findByRole('button', { name: 'Push-up' })
  expect(within(dialog).queryByRole('button', { name: 'Bench Press' })).toBeNull()

  await user.type(within(dialog).getByLabelText('Search exercises'), 'zzz')
  expect(within(dialog).getByText('No exercises match your search.')).toBeTruthy()
})

test('reorders items and days with the arrow buttons', async () => {
  const user = userEvent.setup()
  const { repo, plan, byName, view } = await setup()
  const day = await repo.savePlanDay({ plan_id: plan.id, name: 'Day A' })
  await repo.savePlanDay({ plan_id: plan.id, name: 'Day B' })
  await repo.addPlanItem(day.id, byName('Back Squat').id)
  await repo.addPlanItem(day.id, byName('Bench Press').id)
  view()
  await screen.findByRole('listitem', { name: 'Back Squat' })
  const order = () => screen.getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))
  expect(order()).toEqual(['Back Squat', 'Bench Press'])
  await user.click(screen.getByRole('button', { name: 'Move Bench Press up' }))
  await waitFor(() => expect(order()).toEqual(['Bench Press', 'Back Squat']))

  await user.click(screen.getByRole('button', { name: 'Move Day A down' }))
  await waitFor(() =>
    expect(screen.getAllByLabelText('Day name').map((i) => (i as HTMLInputElement).value)).toEqual([
      'Day B',
      'Day A',
    ]),
  )
})

test('rule editor: add_reps with ceiling, then no progression and back to default', async () => {
  const user = userEvent.setup()
  const { repo, plan, byName, view } = await setup()
  const day = await repo.savePlanDay({ plan_id: plan.id, name: 'Day A' })
  const item = await repo.addPlanItem(day.id, byName('Back Squat').id)
  const rule = async () =>
    (await repo.getPlan(plan.id))!.days[0]!.items.find((i) => i.id === item.id)!.rule
  const inc = (await repo.getProfile()).weight_increment

  view()
  await screen.findByRole('listitem', { name: 'Back Squat' })
  await user.click(screen.getByRole('button', { name: 'Progression for Back Squat' }))
  const row = itemRow('Back Squat')
  await user.selectOptions(within(row).getByLabelText('On success'), 'add_reps')
  await waitFor(async () => expect((await rule())?.success_action).toBe('add_reps'))
  expect((await rule())?.success_amount).toBe(1)

  await user.type(within(itemRow('Back Squat')).getByLabelText('Rep ceiling'), '12{Enter}')
  await waitFor(async () => expect((await rule())?.rep_ceiling).toBe(12))

  // amount must be > 0: zero is rejected and the stored value stays
  const amount = within(itemRow('Back Squat')).getByLabelText('Add (reps)')
  await user.clear(amount)
  await user.type(amount, '0{Enter}')
  await waitFor(() => expect((amount as HTMLInputElement).value).toBe('1'))
  expect((await rule())?.success_amount).toBe(1)

  const off = within(itemRow('Back Squat')).getByRole('switch', { name: /No progression/ })
  await user.click(off)
  await waitFor(async () => expect(await rule()).toBeNull())
  await user.click(within(itemRow('Back Squat')).getByRole('switch', { name: /No progression/ }))
  await waitFor(async () => expect(await rule()).not.toBeNull())
  const restored = (await rule())!
  expect(restored).toMatchObject({
    success_action: 'add_weight',
    success_amount: inc,
    fail_streak_limit: 3,
    deload_pct: 10,
    rep_ceiling: null,
  })
})

test('renames the plan and a day; empty names are ignored', async () => {
  const user = userEvent.setup()
  const { repo, plan, view } = await setup()
  await repo.savePlanDay({ plan_id: plan.id, name: 'Day A' })
  view()
  const name = await screen.findByLabelText('Plan name')
  await user.clear(name)
  await user.tab()
  expect((name as HTMLInputElement).value).toBe('Starter')
  await user.type(name, ' 5x5{Enter}')
  await waitFor(async () => expect((await repo.getPlan(plan.id))!.name).toBe('Starter 5x5'))
  const day = screen.getByLabelText('Day name')
  await user.clear(day)
  await user.type(day, 'Push{Enter}')
  await waitFor(async () => expect((await repo.getPlan(plan.id))!.days[0]!.name).toBe('Push'))
})

test('deleting a day removes it after confirm', async () => {
  const user = userEvent.setup()
  const { repo, plan, view } = await setup()
  await repo.savePlanDay({ plan_id: plan.id, name: 'Day A' })
  await repo.savePlanDay({ plan_id: plan.id, name: 'Day B' })
  view()
  await screen.findByRole('region', { name: 'Day Day A' })
  await user.click(screen.getByRole('button', { name: 'Delete Day A' }))
  expect((await repo.getPlan(plan.id))!.days.length).toBe(2)
  await user.click(screen.getByRole('button', { name: 'Confirm delete Day A' }))
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Day Day A' })).toBeNull())
  expect((await repo.getPlan(plan.id))!.days.map((d) => d.name)).toEqual(['Day B'])
})

test('shows a not-found state with a link back', async () => {
  const { view } = await setup('/plans/does-not-exist')
  view()
  expect(await screen.findByText('Plan not found')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Back to plans' }).getAttribute('href')).toBe('/plans')
})

test('sets and reps reject 0 without calling the repo or showing a toast', async () => {
  const user = userEvent.setup()
  const errSpy = vi.spyOn(toast, 'error')
  const { repo, plan, byName, view } = await setup()
  const day = await repo.savePlanDay({ plan_id: plan.id, name: 'Day A' })
  const item = await repo.addPlanItem(day.id, byName('Back Squat').id)
  await repo.updatePlanItem(item.id, { sets: 4, reps: 6 })
  view()
  await screen.findByRole('listitem', { name: 'Back Squat' })
  for (const [label, prev] of [['Sets', '4'], ['Reps', '6']] as const) {
    const field = within(itemRow('Back Squat')).getByLabelText(label) as HTMLInputElement
    await user.clear(field)
    await user.type(field, '0{Enter}')
    await waitFor(() => expect(field.value).toBe(prev))
  }
  const stored = (await repo.getPlan(plan.id))!.days[0]!.items[0]!
  expect([stored.sets, stored.reps]).toEqual([4, 6])
  expect(errSpy).not.toHaveBeenCalled()
  errSpy.mockRestore()
})

async function ruleSetup() {
  const s = await setup()
  const day = await s.repo.savePlanDay({ plan_id: s.plan.id, name: 'Day A' })
  const item = await s.repo.addPlanItem(day.id, s.byName('Back Squat').id)
  const rule = async () =>
    (await s.repo.getPlan(s.plan.id))!.days[0]!.items.find((i) => i.id === item.id)!.rule!
  s.view()
  await screen.findByRole('listitem', { name: 'Back Squat' })
  await userEvent.click(screen.getByRole('button', { name: 'Progression for Back Squat' }))
  return { ...s, rule }
}
const field = (label: string) =>
  within(itemRow('Back Squat')).getByLabelText(label) as HTMLInputElement

test('rule editor: add_reps back to add_weight resets amount to the increment', async () => {
  const user = userEvent.setup()
  const { repo, rule } = await ruleSetup()
  const inc = (await repo.getProfile()).weight_increment
  const select = within(itemRow('Back Squat')).getByLabelText('On success')
  await user.selectOptions(select, 'add_reps')
  await waitFor(async () => expect((await rule()).success_action).toBe('add_reps'))
  await user.selectOptions(select, 'add_weight')
  await waitFor(async () => expect((await rule()).success_action).toBe('add_weight'))
  expect((await rule()).success_amount).toBe(inc)
})

test('rule editor rejects invalid deload, fail limit; blank ceiling saves null', async () => {
  const user = userEvent.setup()
  const { rule } = await ruleSetup()
  for (const [label, bad, prev] of [
    ['Deload %', '0', '10'],
    ['Deload %', '101', '10'],
    ['Fail streak limit', '0', '3'],
  ] as const) {
    const f = field(label)
    await user.clear(f)
    await user.type(f, `${bad}{Enter}`)
    await waitFor(() => expect(field(label).value).toBe(prev))
  }
  expect(await rule()).toMatchObject({ deload_pct: 10, fail_streak_limit: 3 })

  await user.type(field('Rep ceiling'), '12{Enter}')
  await waitFor(async () => expect((await rule()).rep_ceiling).toBe(12))
  await user.clear(field('Rep ceiling'))
  await user.tab()
  await waitFor(async () => expect((await rule()).rep_ceiling).toBeNull())
})

async function withItem() {
  const ctx = await setup()
  const day = await ctx.repo.savePlanDay({ plan_id: ctx.plan.id, name: 'Day A' })
  const item = await ctx.repo.addPlanItem(day.id, ctx.byName('Bench Press').id)
  await ctx.repo.updatePlanItem(item.id, { sets: 3, reps: 5, weight: 95 })
  return { ...ctx, day, item }
}

test('retyping the same override value keeps progression targets', async () => {
  const user = userEvent.setup()
  const { repo, plan, day, view } = await withItem()
  const session = await repo.startSession(day.id)
  for (const s of session.exercises[0]!.sets) await repo.updateSet(s.id, { done: true })
  await repo.finishSession(session.id)
  view()
  const row = await screen.findByRole('listitem', { name: 'Bench Press' })
  expect(within(row).getByText('Next: 3×5 @ 100 lb')).toBeTruthy()
  const update = vi.spyOn(repo, 'updatePlanItem')
  const reps = within(row).getByLabelText('Reps')
  await user.clear(reps)
  await user.type(reps, '5{Enter}')
  await new Promise((r) => setTimeout(r, 100))
  expect(update).not.toHaveBeenCalled()
  const tree = (await repo.getPlan(plan.id))!
  expect(tree.days[0]!.items[0]!.effective.targetWeight).toBe(100)
})

test('a failed override write reverts the field and toasts a friendly error', async () => {
  const user = userEvent.setup()
  const { repo, view } = await withItem()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const err = vi.spyOn(toast, 'error')
  view()
  const row = await screen.findByRole('listitem', { name: 'Bench Press' })
  vi.spyOn(repo, 'updatePlanItem').mockRejectedValue(new Error('disk exploded'))
  const reps = within(row).getByLabelText('Reps') as HTMLInputElement
  await user.clear(reps)
  await user.type(reps, '9{Enter}')
  await waitFor(() => expect(err).toHaveBeenCalledWith("Couldn't save that change"))
  await waitFor(() => expect(reps.value).toBe('5'))
})

test('add_weight rule editor explains progression step snapping, add_reps does not', async () => {
  const user = userEvent.setup()
  const { repo, item, view } = await withItem()
  await repo.updateProfile({ weight_increment: 2.5 })
  view()
  const row = await screen.findByRole('listitem', { name: 'Bench Press' })
  await user.click(within(row).getByRole('button', { name: 'Progression for Bench Press' }))
  expect(
    await within(row).findByText('Steps snap to your 2.5 lb progression step (change it in the Progression tab).'),
  ).toBeTruthy()
  void item
  await user.selectOptions(within(row).getByLabelText('On success'), 'add_reps')
  await waitFor(() => expect(within(row).queryByText(/Steps snap to/)).toBeNull())
})

test('re-enabling progression restores the profile default rule', async () => {
  const user = userEvent.setup()
  const { repo, plan, view } = await withItem()
  const dflt = {
    success_action: 'add_reps' as const,
    success_amount: 2,
    fail_streak_limit: 2,
    deload_pct: 15,
    rep_ceiling: 10,
  }
  await repo.updateProfile({ default_rule: dflt })
  view()
  const row = await screen.findByRole('listitem', { name: 'Bench Press' })
  await user.click(within(row).getByRole('button', { name: 'Progression for Bench Press' }))
  const sw = within(row).getByRole('switch')
  await user.click(sw)
  await waitFor(async () =>
    expect((await repo.getPlan(plan.id))?.days[0]?.items[0]?.rule).toBeNull(),
  )
  await user.click(sw)
  await waitFor(async () =>
    expect((await repo.getPlan(plan.id))?.days[0]?.items[0]?.rule).toMatchObject(dflt),
  )
})

async function openPicker(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /Add exercise to Day A/ }))
  return screen.findByRole('dialog')
}

test('picker offers a Create row that prefills the sheet and adds the new exercise to the day', async () => {
  const user = userEvent.setup()
  const ok = vi.spyOn(toast, 'success')
  const { repo, plan, view } = await setup()
  await repo.savePlanDay({ plan_id: plan.id, name: 'Day A' })
  view()
  const picker = await openPicker(user)
  await user.type(await within(picker).findByLabelText('Search exercises'), 'Zercher Squat')
  const create = within(picker).getByRole('button', { name: 'Create "Zercher Squat"' })
  // the create row sits at the top of the list
  expect(within(picker).getAllByRole('button').filter((b) => b.closest('li'))[0]).toBe(create)
  await user.click(create)

  const sheet = await screen.findByRole('dialog', { name: 'Add exercise' })
  expect((within(sheet).getByLabelText('Name') as HTMLInputElement).value).toBe('Zercher Squat')
  await user.click(within(sheet).getByRole('button', { name: 'Save and add to Day A' }))

  await waitFor(async () => {
    expect((await repo.getPlan(plan.id))!.days[0]!.items).toHaveLength(1)
  })
  const created = (await repo.listExercises()).filter((e) => e.name === 'Zercher Squat')
  expect(created).toHaveLength(1)
  expect((await repo.getPlan(plan.id))!.days[0]!.items[0]!.exercise_id).toBe(created[0]!.id)
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(await screen.findByRole('listitem', { name: 'Zercher Squat' })).toBeTruthy()
  expect(ok).toHaveBeenCalledWith('Added Zercher Squat to Day A')
})

test('no Create row without a query or when the name already exists', async () => {
  const user = userEvent.setup()
  const { repo, plan, view } = await setup()
  await repo.savePlanDay({ plan_id: plan.id, name: 'Day A' })
  view()
  const picker = await openPicker(user)
  await within(picker).findByRole('button', { name: 'Bench Press' })
  expect(within(picker).queryByRole('button', { name: /^Create/ })).toBeNull()
  await user.type(within(picker).getByLabelText('Search exercises'), 'bench press')
  expect(within(picker).queryByRole('button', { name: /^Create/ })).toBeNull()
})

test('no match shows one clear action: create the typed name', async () => {
  const user = userEvent.setup()
  const { repo, plan, view } = await setup()
  await repo.savePlanDay({ plan_id: plan.id, name: 'Day A' })
  view()
  const picker = await openPicker(user)
  await user.type(await within(picker).findByLabelText('Search exercises'), 'zzz')
  expect(within(picker).getByText('No exercises match your search.')).toBeTruthy()
  expect(within(picker).getAllByRole('button', { name: /^Create/ })).toHaveLength(1)
})

test('keeps the new exercise and tells the user when adding it to the day fails', async () => {
  const user = userEvent.setup()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const err = vi.spyOn(toast, 'error')
  const { repo, plan, view } = await setup()
  await repo.savePlanDay({ plan_id: plan.id, name: 'Day A' })
  vi.spyOn(repo, 'addPlanItem').mockRejectedValue(new Error('disk exploded'))
  view()
  const picker = await openPicker(user)
  await user.type(await within(picker).findByLabelText('Search exercises'), 'Zercher Squat')
  await user.click(within(picker).getByRole('button', { name: 'Create "Zercher Squat"' }))
  const sheet = await screen.findByRole('dialog', { name: 'Add exercise' })
  await user.click(within(sheet).getByRole('button', { name: 'Save and add to Day A' }))

  await waitFor(() =>
    expect(err).toHaveBeenCalledWith("Saved Zercher Squat, but couldn't add it to Day A. Add it from the picker."),
  )
  expect((await repo.listExercises()).some((e) => e.name === 'Zercher Squat')).toBe(true)
  expect((await repo.getPlan(plan.id))!.days[0]!.items).toHaveLength(0)
})

test('does not add anything and keeps the sheet open when creating the exercise fails', async () => {
  const user = userEvent.setup()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const err = vi.spyOn(toast, 'error')
  const { repo, plan, view } = await setup()
  await repo.savePlanDay({ plan_id: plan.id, name: 'Day A' })
  const add = vi.spyOn(repo, 'addPlanItem')
  vi.spyOn(repo, 'saveExercise').mockRejectedValue(new Error('nope'))
  view()
  const picker = await openPicker(user)
  await user.type(await within(picker).findByLabelText('Search exercises'), 'Zercher Squat')
  await user.click(within(picker).getByRole('button', { name: 'Create "Zercher Squat"' }))
  const sheet = await screen.findByRole('dialog', { name: 'Add exercise' })
  await user.click(within(sheet).getByRole('button', { name: 'Save and add to Day A' }))
  await waitFor(() => expect(err).toHaveBeenCalledWith("Couldn't save the exercise"))
  expect(add).not.toHaveBeenCalled()
  expect(screen.getByRole('dialog', { name: 'Add exercise' })).toBeTruthy()
})

test('picker rows show a muted defaults line; search autofocuses only on desktop widths', async () => {
  const user = userEvent.setup()
  const original = window.matchMedia
  const media = (matches: boolean) =>
    (window.matchMedia = ((q: string) => ({ matches, media: q, addEventListener() {}, removeEventListener() {} })) as never)
  try {
    media(false)
    const { repo, plan, view } = await setup()
    await repo.savePlanDay({ plan_id: plan.id, name: 'Day A' })
    view()
    const picker = await openPicker(user)
    const row = await within(picker).findByRole('button', { name: 'Bench Press' })
    expect(row.getAttribute('aria-describedby')).toBeTruthy()
    expect(document.getElementById(row.getAttribute('aria-describedby')!)!.textContent).toMatch(/3×5 @ 95 lb/)
    expect(document.activeElement).not.toBe(within(picker).getByLabelText('Search exercises'))
  } finally {
    window.matchMedia = original
  }
})
