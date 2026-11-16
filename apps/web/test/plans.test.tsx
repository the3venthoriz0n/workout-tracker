import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { routes } from '../src/app/router'
import { AppDb } from '../src/repo/db'
import { LocalRepo } from '../src/repo/local-repo'
import { RepoProvider } from '../src/repo/provider'
import { LISTING_ID, detail, guestRepo, json, renderApp, snapshot, stubFetch } from './community-helpers'

function renderPlans(repo = new LocalRepo(new AppDb(`plans-${crypto.randomUUID()}`))) {
  const router = createMemoryRouter(routes, { initialEntries: ['/plans'] })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RepoProvider repo={repo}>
        <RouterProvider router={router} />
      </RepoProvider>
    </QueryClientProvider>,
  )
  return { repo, router }
}

test('Add plan matches the Library Add button and goes straight into the new plan with its name selected', async () => {
  const user = userEvent.setup()
  const { repo, router } = renderPlans()
  const add = await screen.findByRole('button', { name: 'Add plan' })
  expect(add.textContent).toContain('Add')
  expect(add.querySelector('svg')).not.toBeNull()
  expect(screen.queryByLabelText('New plan name')).toBeNull()
  await user.click(add)
  await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/plans\/.+/))
  expect((await repo.listPlans()).map((p) => p.name)).toEqual(['New plan'])
  const name = (await screen.findByLabelText('Plan name')) as HTMLInputElement
  await waitFor(() => expect(document.activeElement).toBe(name))
  expect(name.value).toBe('New plan')
  expect(name.selectionStart).toBe(0)
  expect(name.selectionEnd).toBe('New plan'.length)
  await user.keyboard('Starter{Enter}')
  await waitFor(async () => expect((await repo.listPlans()).map((p) => p.name)).toEqual(['Starter']))
})

test('the empty state offers Create plan, which behaves like Add', async () => {
  const user = userEvent.setup()
  const { router } = renderPlans()
  await user.click(await screen.findByRole('button', { name: /Create plan/ }))
  await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/plans\/.+/))
})

test('plan list rows have no Delete text; deleting a plan lives on its page and needs a confirm step', async () => {
  const user = userEvent.setup()
  const repo = new LocalRepo(new AppDb(`plans-${crypto.randomUUID()}`))
  await repo.init()
  const old = await repo.savePlan({ name: 'Old' })
  const { router } = renderPlans(repo)
  await screen.findByRole('link', { name: /Old/ })
  // Rows carry icon-only edit and delete buttons (no text); the plan page still has its own delete
  expect(screen.getByRole('button', { name: 'Edit Old' }).textContent).toBe('')
  expect(screen.getByRole('button', { name: 'Delete Old' }).textContent).toBe('')
  expect(screen.queryByText('Delete')).toBeNull()
  await router.navigate(`/plans/${old.id}`)
  await user.click(await screen.findByRole('button', { name: 'Delete plan' }))
  expect((await repo.listPlans()).length).toBe(1)
  await user.click(screen.getByRole('button', { name: 'Confirm delete plan' }))
  await waitFor(async () => expect(await repo.listPlans()).toEqual([]))
  await waitFor(() => expect(router.state.location.pathname).toBe('/plans'))
  await waitFor(() => expect(screen.queryByRole('link', { name: /Old/ })).toBeNull())
})

describe('community source line', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  async function adopted() {
    const repo = await guestRepo('plans-src')
    await repo.adoptSharedPlan({ shared_plan_id: LISTING_ID, version: 1, snapshot, title: 'Strong Start', author: 'Sam Lifts' })
    await repo.savePlan({ name: 'Own plan' })
    return repo
  }

  test('copies show "Based on" and "Update available" when the public version is newer; own plans show nothing', async () => {
    const spy = stubFetch((u) => (u.pathname === `/api/public/plans/${LISTING_ID}` ? json(detail({}, 3)) : undefined))
    renderApp(await adopted(), '/plans')
    expect(await screen.findByText('Based on Strong Start by Sam Lifts · v1')).toBeTruthy()
    expect(await screen.findByText('Update available')).toBeTruthy()
    expect(screen.getAllByText(/Based on/)).toHaveLength(1)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  test('no pill when up to date, and nothing when offline', async () => {
    stubFetch((u) => (u.pathname === `/api/public/plans/${LISTING_ID}` ? json(detail({}, 1)) : undefined))
    renderApp(await adopted(), '/plans')
    expect(await screen.findByText(/Based on Strong Start/)).toBeTruthy()
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByText('Update available')).toBeNull()
  })

  test('offline: the source line stays and no error is shown', async () => {
    const err = vi.spyOn(console, 'error')
    stubFetch(() => undefined)
    renderApp(await adopted(), '/plans')
    expect(await screen.findByText(/Based on Strong Start/)).toBeTruthy()
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByText('Update available')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(err).not.toHaveBeenCalled()
  })
})

test('a plan row renames in place and deletes after a confirm, without opening the plan', async () => {
  const user = userEvent.setup()
  const repo = new LocalRepo(new AppDb(`plans-${crypto.randomUUID()}`))
  await repo.init()
  await repo.savePlan({ name: 'Old' })
  const keep = await repo.savePlan({ name: 'Keep' })
  const { router } = renderPlans(repo)

  await user.click(await screen.findByRole('button', { name: 'Edit Old' }))
  const input = (await screen.findByLabelText('Name for Old')) as HTMLInputElement
  await user.clear(input)
  await user.type(input, 'Renamed{Enter}')
  await screen.findByRole('link', { name: /Renamed/ })
  expect((await repo.listPlans()).map((p) => p.name).sort()).toEqual(['Keep', 'Renamed'])
  expect(router.state.location.pathname).toBe('/plans')

  await user.click(screen.getByRole('button', { name: 'Edit Keep' }))
  await user.keyboard('{Escape}')
  expect(screen.queryByLabelText('Name for Keep')).toBeNull()
  expect((await repo.getPlan(keep.id))!.name).toBe('Keep')

  await user.click(screen.getByRole('button', { name: 'Delete Renamed' }))
  expect((await repo.listPlans()).length).toBe(2)
  const group = await screen.findByRole('group', { name: 'Confirm delete Renamed' })
  await user.click(within(group).getByRole('button', { name: 'Delete' }))
  await waitFor(async () => expect((await repo.listPlans()).map((p) => p.name)).toEqual(['Keep']))
  expect(router.state.location.pathname).toBe('/plans')
})

test('a published plan shows a Community link on its row; unpublished and private plans do not; every row can be shared', async () => {
  const repo = new LocalRepo(new AppDb(`plans-${crypto.randomUUID()}`))
  await repo.init()
  const live = await repo.savePlan({ name: 'Live' })
  const gone = await repo.savePlan({ name: 'Gone' })
  await repo.savePlan({ name: 'Private' })
  const listPlans = repo.listPlans.bind(repo)
  repo.listPlans = async () =>
    (await listPlans()).map((p) =>
      p.id === live.id
        ? { ...p, published: { shared_plan_id: LISTING_ID, version: 2, status: 'published' as const } }
        : p.id === gone.id
          ? { ...p, published: { shared_plan_id: LISTING_ID, version: 1, status: 'unpublished' as const } }
          : p,
    )
  renderPlans(repo)
  const link = await screen.findByRole('link', { name: 'View Live in Community' })
  expect(link.getAttribute('href')).toBe(`/plans/community/${LISTING_ID}`)
  expect(screen.queryByRole('link', { name: 'View Gone in Community' })).toBeNull()
  expect(screen.queryByRole('link', { name: 'View Private in Community' })).toBeNull()
  for (const n of ['Live', 'Gone', 'Private']) expect(screen.getByRole('button', { name: `Share ${n}` })).toBeTruthy()
})
