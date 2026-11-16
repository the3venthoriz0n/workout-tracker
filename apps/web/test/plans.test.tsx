import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
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
  expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull()
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
