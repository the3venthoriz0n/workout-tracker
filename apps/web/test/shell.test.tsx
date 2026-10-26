import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import userEvent from '@testing-library/user-event'
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

test('shell renders the Library route with five tabs and a Settings gear in the header', async () => {
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
  for (const label of ['Today', 'Plans', 'Library', 'Progress', 'History']) {
    expect(screen.getByRole('link', { name: label })).toBeTruthy()
  }
  const nav = within(screen.getByRole('navigation', { name: 'Main' }))
  expect(nav.queryByRole('link', { name: 'Settings' })).toBeNull()
  const gear = screen.getByRole('link', { name: 'Settings' })
  expect(gear.getAttribute('href')).toBe('/settings')
  expect(screen.getByRole('heading', { name: 'Library' }).parentElement!.contains(gear)).toBe(true)
})

test('Progress sits after Library and highlights on /progression', async () => {
  renderAt('/progression')
  expect(
    (await screen.findByRole('link', { name: 'Progress' })).getAttribute('aria-current'),
  ).toBe('page')
  const nav = within(screen.getByRole('navigation', { name: 'Main' }))
  expect(nav.getAllByRole('link').map((l) => l.textContent)).toEqual([
    'Today',
    'Plans',
    'Library',
    'Progress',
    'History',
  ])
  expect(screen.getByRole('link', { name: 'Library' }).getAttribute('aria-current')).toBeNull()
})

test('Library stays highlighted on a section deep link', async () => {
  renderAt('/library?section=gear')
  expect((await screen.findByRole('link', { name: 'Library' })).getAttribute('aria-current')).toBe(
    'page',
  )
})

test('the floating nav keeps five links with exactly one aria-current', async () => {
  renderAt('/')
  const nav = within(await screen.findByRole('navigation', { name: 'Main' }))
  const links = nav.getAllByRole('link')
  expect(links).toHaveLength(5)
  expect(links.filter((l) => l.getAttribute('aria-current') === 'page').map((l) => l.textContent)).toEqual(['Today'])
})

test('detail screens name their back link apart from the nav tab', async () => {
  renderAt('/history/x')
  const back = await screen.findByRole('link', { name: 'Back to history' })
  expect(back.getAttribute('href')).toBe('/history')
  expect(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'History' })).not.toBe(back)
})

test('the add exercise sheet is a labelled dialog', async () => {
  const user = userEvent.setup()
  renderAt('/library')
  await user.click(await screen.findByRole('button', { name: 'Add exercise' }))
  const dialog = await screen.findByRole('dialog', { name: 'Add exercise' })
  expect(within(dialog).getByRole('button', { name: 'Close' })).toBeTruthy()
})
