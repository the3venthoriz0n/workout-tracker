import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { afterEach, expect, test, vi } from 'vitest'
import { routes } from '../src/app/router'
import { AppDb } from '../src/repo/db'
import { LocalRepo } from '../src/repo/local-repo'
import { RepoProvider } from '../src/repo/provider'

afterEach(() => {
  vi.restoreAllMocks()
})

function renderSettings() {
  const repo = new LocalRepo(new AppDb(`set-${crypto.randomUUID()}`))
  const router = createMemoryRouter(routes, { initialEntries: ['/settings'] })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RepoProvider repo={repo}>
        <RouterProvider router={router} />
      </RepoProvider>
    </QueryClientProvider>,
  )
  return repo
}

test('Settings no longer shows gear, but keeps units, export and account', async () => {
  renderSettings()
  expect(await screen.findByText('Accounts and sync are coming soon.')).toBeTruthy()
  expect(screen.queryAllByRole('switch')).toHaveLength(0)
  expect(screen.queryByRole('button', { name: 'Add custom gear' })).toBeNull()
  expect(screen.queryByLabelText('Custom gear name')).toBeNull()
  expect(screen.getByRole('radio', { name: 'kg' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Export data' })).toBeTruthy()
})

test('changing units asks for confirmation then converts weights', async () => {
  const user = userEvent.setup()
  const repo = renderSettings()
  await screen.findByText('Accounts and sync are coming soon.')
  const deadlift = (await repo.listExercises()).find((e) => e.name === 'Deadlift')!
  expect(deadlift.default_weight).toBe(135)
  await user.click(screen.getByRole('radio', { name: 'kg' }))
  expect((await repo.getProfile()).units).toBe('lb')
  await user.click(await screen.findByRole('button', { name: 'Convert to kg' }))
  await waitFor(async () => expect((await repo.getProfile()).units).toBe('kg'))
  const after = (await repo.listExercises()).find((e) => e.id === deadlift.id)!
  expect(after.default_weight).toBe(61.2)
})

test('increment must be greater than 0 and persists otherwise', async () => {
  const user = userEvent.setup()
  const repo = renderSettings()
  const input = await screen.findByLabelText('Weight increment')
  await user.clear(input)
  await user.type(input, '0')
  await user.tab()
  expect(await screen.findByText('Increment must be greater than 0.')).toBeTruthy()
  expect((await repo.getProfile()).weight_increment).toBe(5)
  await waitFor(() => expect((input as HTMLInputElement).value).toBe('5'))
  await user.clear(input)
  await user.type(input, '2,5')
  await user.tab()
  await waitFor(async () => expect((await repo.getProfile()).weight_increment).toBe(2.5))
})

test('export calls exportAll and downloads a dated file', async () => {
  const user = userEvent.setup()
  const repo = renderSettings()
  const spy = vi.spyOn(repo, 'exportAll')
  const create = vi.fn(() => 'blob:x')
  const revoke = vi.fn()
  URL.createObjectURL = create
  URL.revokeObjectURL = revoke
  let name = ''
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(function (this: HTMLAnchorElement) {
      name = this.download
    })
  await user.click(await screen.findByRole('button', { name: 'Export data' }))
  await waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:x'))
  expect(spy).toHaveBeenCalled()
  expect(name).toMatch(/^workout-tracker-export-\d{4}-\d{2}-\d{2}\.json$/)
  click.mockRestore()
})
