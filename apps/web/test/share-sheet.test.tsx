import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PublishLimitError, ValidationError, snapshotFromPlanTree, type SharedListing } from '@workout/shared'
import { toast } from 'sonner'
import { afterEach, expect, test, vi } from 'vitest'
import type { LocalRepo } from '../src/repo/local-repo'
import { LISTING_ID, guestRepo, json, renderApp, stubFetch } from './community-helpers'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function planWithItem(repo: LocalRepo) {
  const plan = await repo.savePlan({ name: 'Starter' })
  const day = await repo.savePlanDay({ plan_id: plan.id, name: 'Day A' })
  const squat = (await repo.listExercises()).find((e) => e.name === 'Back Squat')!
  await repo.addPlanItem(day.id, squat.id)
  return plan
}

const mine = (over: Partial<SharedListing> = {}): SharedListing => ({
  id: LISTING_ID,
  plan_id: null,
  title: 'Starter for all',
  description: 'Easy',
  level: 'beginner',
  status: 'published',
  version: 1,
  upvotes: 3,
  downloads: 7,
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
  ...over,
})

/** A guest LocalRepo dressed up as a signed-in repo: publish state lives in `state`. */
function signedIn(repo: LocalRepo, opts: { published?: number; status?: SharedListing['status'] } = {}) {
  const state = { version: opts.published ?? 0, status: opts.status ?? ('published' as SharedListing['status']) }
  const getPlan = repo.getPlan.bind(repo)
  const publishPlan = vi.fn(async (_planId: string, _meta: unknown) => {
    state.version += 1
    state.status = 'published'
    return { shared_plan_id: LISTING_ID, version: state.version }
  })
  const unpublishPlan = vi.fn(async () => {
    state.status = 'unpublished'
  })
  Object.assign(repo, {
    async getPlan(id: string) {
      const t = await getPlan(id)
      return t && state.version > 0 ? { ...t, published: { shared_plan_id: LISTING_ID, version: state.version, status: state.status } } : t
    },
    publishPlan,
    unpublishPlan,
    listMyShared: vi.fn(async () => (state.version > 0 ? [mine({ version: state.version, status: state.status })] : [])),
  })
  return { publishPlan, unpublishPlan, state }
}

async function openSheet(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Share' }))
  return screen.findByRole('dialog', { name: 'Share plan' })
}

test('guests are asked to create an account', async () => {
  const user = userEvent.setup()
  const repo = await guestRepo()
  const plan = await planWithItem(repo)
  const publish = vi.spyOn(repo, 'publishPlan')
  renderApp(repo, `/plans/${plan.id}`)
  const sheet = await openSheet(user)
  expect(within(sheet).getByText('Create an account to share plans')).toBeTruthy()
  expect(within(sheet).getByRole('link', { name: /Settings/ }).getAttribute('href')).toBe('/settings')
  expect(within(sheet).queryByLabelText('Title')).toBeNull()
  expect(publish).not.toHaveBeenCalled()
})

test('a public name is required first, then title, description and level are validated', async () => {
  const user = userEvent.setup()
  const repo = await guestRepo()
  const plan = await planWithItem(repo)
  const { publishPlan } = signedIn(repo)
  stubFetch(() => undefined)
  renderApp(repo, `/plans/${plan.id}`, { signedIn: true })
  let sheet = await openSheet(user)
  expect(within(sheet).queryByLabelText('Title')).toBeNull()
  expect(within(sheet).getByRole('link', { name: /Settings/ })).toBeTruthy()
  await user.type(within(sheet).getByLabelText('Public name'), 'x')
  await user.click(within(sheet).getByRole('button', { name: 'Save name' }))
  expect((await within(sheet).findByRole('alert')).textContent).toMatch(/2 to 30/)
  await user.clear(within(sheet).getByLabelText('Public name'))
  await user.type(within(sheet).getByLabelText('Public name'), 'Sam Lifts')
  await user.click(within(sheet).getByRole('button', { name: 'Save name' }))
  await waitFor(async () => expect((await repo.getProfile()).display_name).toBe('Sam Lifts'))

  sheet = screen.getByRole('dialog', { name: 'Share plan' })
  const title = (await within(sheet).findByLabelText('Title')) as HTMLInputElement
  expect(title.value).toBe('Starter')
  await user.clear(title)
  await user.type(title, 'ab')
  await user.type(within(sheet).getByLabelText(/Description/), 'see www.example.invalid')
  await user.click(within(sheet).getByRole('button', { name: 'Publish' }))
  expect(await within(sheet).findByText('Title must be 3 to 60 characters.')).toBeTruthy()
  expect(within(sheet).getByText("Links aren't allowed.")).toBeTruthy()
  expect(publishPlan).not.toHaveBeenCalled()

  await user.type(title, 'c plan')
  await user.clear(within(sheet).getByLabelText(/Description/))
  await user.type(within(sheet).getByLabelText(/Description/), 'Simple.')
  await user.click(within(sheet).getByRole('radio', { name: 'Advanced' }))
  await user.click(within(sheet).getByRole('button', { name: 'Publish' }))
  await waitFor(() => expect(publishPlan).toHaveBeenCalledWith(plan.id, { title: 'abc plan', description: 'Simple.', level: 'advanced' }))
})

test('publish limit, server field errors, then success shows the status with counts', async () => {
  const user = userEvent.setup()
  const repo = await guestRepo()
  await repo.updateProfile({ display_name: 'Sam Lifts' })
  const plan = await planWithItem(repo)
  const { publishPlan } = signedIn(repo)
  publishPlan.mockRejectedValueOnce(new PublishLimitError()).mockRejectedValueOnce(new ValidationError('title'))
  const ok = vi.spyOn(toast, 'success')
  stubFetch(() => undefined) // public API unreachable: "Publish update" stays allowed
  renderApp(repo, `/plans/${plan.id}`, { signedIn: true })
  const sheet = await openSheet(user)
  await user.click(within(sheet).getByRole('button', { name: 'Publish' }))
  expect((await within(sheet).findByRole('alert')).textContent).toBe('You can publish 5 times a day. Try again tomorrow.')
  await user.click(within(sheet).getByRole('button', { name: 'Publish' }))
  expect(await within(sheet).findByText('Check the title.')).toBeTruthy()
  await user.click(within(sheet).getByRole('button', { name: 'Publish' }))
  await waitFor(() => expect(ok).toHaveBeenCalledWith('Published v1'))
  expect(await within(sheet).findByText(/Shared · v1/)).toBeTruthy()
  expect(within(sheet).getByLabelText('3 upvotes')).toBeTruthy()
  expect(within(sheet).getByLabelText('7 downloads')).toBeTruthy()
  expect(within(sheet).getByRole('button', { name: 'Publish update' }).hasAttribute('disabled')).toBe(false)
})

test('an unshareable plan explains why before calling the server', async () => {
  const user = userEvent.setup()
  const repo = await guestRepo()
  await repo.updateProfile({ display_name: 'Sam Lifts' })
  const plan = await repo.savePlan({ name: 'Empty' })
  const { publishPlan } = signedIn(repo)
  renderApp(repo, `/plans/${plan.id}`, { signedIn: true })
  const sheet = await openSheet(user)
  await user.click(within(sheet).getByRole('button', { name: 'Publish' }))
  expect((await within(sheet).findByRole('alert')).textContent).toBe('Add at least one exercise before sharing this plan')
  expect(publishPlan).not.toHaveBeenCalled()
})

test('after edits "Publish update" makes v2; unpublish needs a confirm', async () => {
  const user = userEvent.setup()
  const repo = await guestRepo()
  await repo.updateProfile({ display_name: 'Sam Lifts' })
  const plan = await planWithItem(repo)
  const before = snapshotFromPlanTree((await repo.getPlan(plan.id))!, 'lb', await repo.listGear())
  // edit after publishing v1
  const day = (await repo.getPlan(plan.id))!.days[0]!
  await repo.addPlanItem(day.id, (await repo.listExercises()).find((e) => e.name === 'Deadlift')!.id)
  const { publishPlan, unpublishPlan } = signedIn(repo, { published: 1 })
  stubFetch((u) =>
    u.pathname === `/api/public/plans/${LISTING_ID}`
      ? json({ listing: { id: LISTING_ID, title: 'Starter for all', description: 'Easy', level: 'beginner', author: 'Sam Lifts', day_count: 1, version: 1, upvotes: 3, downloads: 7, updated_at: '2026-10-01T00:00:00.000Z' }, version: 1, snapshot: before })
      : undefined,
  )
  renderApp(repo, `/plans/${plan.id}`, { signedIn: true })
  const sheet = await openSheet(user)
  expect(await within(sheet).findByText(/Shared · v1/)).toBeTruthy()
  expect(await within(sheet).findByText('Changed since v1.')).toBeTruthy()
  await user.click(within(sheet).getByRole('button', { name: 'Publish update' }))
  expect((within(sheet).getByLabelText('Title') as HTMLInputElement).value).toBe('Starter for all')
  await user.click(within(sheet).getByRole('button', { name: 'Publish v2' }))
  await waitFor(() => expect(publishPlan).toHaveBeenCalledWith(plan.id, { title: 'Starter for all', description: 'Easy', level: 'beginner' }))
  expect(await within(sheet).findByText(/Shared · v2/)).toBeTruthy()

  await user.click(within(sheet).getByRole('button', { name: 'Unpublish' }))
  expect(unpublishPlan).not.toHaveBeenCalled()
  await user.click(within(sheet).getByRole('button', { name: 'Confirm unpublish' }))
  await waitFor(() => expect(unpublishPlan).toHaveBeenCalledWith(plan.id))
})
