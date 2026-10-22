import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { expect, test } from 'vitest'
import { routes } from '../src/app/router'
import { AppDb } from '../src/repo/db'
import { LocalRepo } from '../src/repo/local-repo'
import { RepoProvider } from '../src/repo/provider'

function renderAt(path: string) {
  const repo = new LocalRepo(new AppDb(`shell-${crypto.randomUUID()}`))
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RepoProvider repo={repo}>
        <RouterProvider router={router} />
      </RepoProvider>
    </QueryClientProvider>,
  )
}

test('nested paths highlight their tab', async () => {
  renderAt('/plans/abc')
  expect((await screen.findByRole('link', { name: 'Plans' })).getAttribute('aria-current')).toBe(
    'page',
  )
  expect(screen.getByRole('link', { name: 'Today' }).getAttribute('aria-current')).toBeNull()
  cleanup()
  renderAt('/history/x')
  expect((await screen.findByRole('link', { name: 'History' })).getAttribute('aria-current')).toBe(
    'page',
  )
})

test('shell renders the Library route with all five tabs', async () => {
  const repo = new LocalRepo(new AppDb(`shell-${crypto.randomUUID()}`))
  const router = createMemoryRouter(routes, { initialEntries: ['/library'] })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RepoProvider repo={repo}>
        <RouterProvider router={router} />
      </RepoProvider>
    </QueryClientProvider>,
  )
  expect(await screen.findByRole('heading', { name: 'Library' })).toBeTruthy()
  for (const label of ['Today', 'Plans', 'Library', 'History', 'Settings']) {
    expect(screen.getByRole('link', { name: label })).toBeTruthy()
  }
})

test('Library stays highlighted on a section deep link', async () => {
  renderAt('/library?section=gear')
  expect((await screen.findByRole('link', { name: 'Library' })).getAttribute('aria-current')).toBe(
    'page',
  )
})
