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

test('creates a plan from the inline input and links to its detail page', async () => {
  const user = userEvent.setup()
  const { repo, router } = renderPlans()
  await user.type(await screen.findByLabelText('New plan name'), 'Starter{Enter}')
  const link = await screen.findByRole('link', { name: /Starter/ })
  expect((await repo.listPlans()).map((p) => p.name)).toEqual(['Starter'])
  expect((screen.getByLabelText('New plan name') as HTMLInputElement).value).toBe('')
  await user.click(link)
  expect(router.state.location.pathname).toMatch(/^\/plans\/.+/)
})

test('ignores an empty plan name', async () => {
  const user = userEvent.setup()
  const { repo } = renderPlans()
  await user.type(await screen.findByLabelText('New plan name'), '   {Enter}')
  expect(await repo.listPlans()).toEqual([])
})

test('deleting a plan needs a confirm step', async () => {
  const user = userEvent.setup()
  const repo = new LocalRepo(new AppDb(`plans-${crypto.randomUUID()}`))
  await repo.init()
  await repo.savePlan({ name: 'Old' })
  renderPlans(repo)
  await user.click(await screen.findByRole('button', { name: 'Delete Old' }))
  expect((await repo.listPlans()).length).toBe(1)
  await user.click(screen.getByRole('button', { name: 'Confirm delete Old' }))
  await waitFor(async () => expect(await repo.listPlans()).toEqual([]))
  await waitFor(() => expect(screen.queryByRole('link', { name: /Old/ })).toBeNull())
})
