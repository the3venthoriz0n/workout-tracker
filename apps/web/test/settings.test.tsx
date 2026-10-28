import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { routes } from '../src/app/router'
import { AppDb } from '../src/repo/db'
import { LocalRepo } from '../src/repo/local-repo'
import { AuthProvider } from '../src/auth/auth-provider'
import { guestRepo, renderApp } from './community-helpers'

afterEach(() => {
  vi.restoreAllMocks()
})

function renderSettings() {
  const repo = new LocalRepo(new AppDb(`set-${crypto.randomUUID()}`))
  const router = createMemoryRouter(routes, { initialEntries: ['/settings'] })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthProvider auth={{ signUp: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), resendSetupLink: vi.fn(), requestPasswordReset: vi.fn(), resetPassword: vi.fn(), deleteAccount: vi.fn(), session: async () => null }} local={repo} createApi={() => ({}) as never}>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  )
  return repo
}

test('Settings no longer shows gear, but keeps units, export and account', async () => {
  renderSettings()
  expect(await screen.findByText('Email')).toBeTruthy()
  expect(screen.queryAllByRole('switch')).toHaveLength(0)
  expect(screen.queryByRole('button', { name: 'Add custom gear' })).toBeNull()
  expect(screen.queryByLabelText('Custom gear name')).toBeNull()
  expect(screen.getByRole('radio', { name: 'kg' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Export my data' })).toBeTruthy()
  // Guests have no account to delete.
  expect(screen.queryByRole('heading', { name: 'Delete account' })).toBeNull()
})

test('changing units asks for confirmation then converts weights', async () => {
  const user = userEvent.setup()
  const repo = renderSettings()
  await screen.findByText('Email')
  const deadlift = (await repo.listExercises()).find((e) => e.name === 'Deadlift')!
  expect(deadlift.default_weight).toBe(135)
  await user.click(screen.getByRole('radio', { name: 'kg' }))
  expect((await repo.getProfile()).units).toBe('lb')
  await user.click(await screen.findByRole('button', { name: 'Convert to kg' }))
  await waitFor(async () => expect((await repo.getProfile()).units).toBe('kg'))
  const after = (await repo.listExercises()).find((e) => e.id === deadlift.id)!
  expect(after.default_weight).toBe(61.2)
})

test('the progression step no longer lives in Settings', async () => {
  renderSettings()
  await screen.findByText('Email')
  expect(screen.queryByLabelText('Weight increment')).toBeNull()
  expect(screen.queryByLabelText('Progression step')).toBeNull()
  expect(screen.queryByText(/increment/i)).toBeNull()
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
  await user.click(await screen.findByRole('button', { name: 'Export my data' }))
  await waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:x'))
  expect(spy).toHaveBeenCalled()
  expect(name).toMatch(/^workout-tracker-export-\d{4}-\d{2}-\d{2}\.json$/)
  click.mockRestore()
})

describe('public name', () => {
  test('guests do not see it', async () => {
    renderSettings()
    await screen.findByText('Email')
    expect(screen.queryByLabelText('Public name')).toBeNull()
  })

  test('signed in: validates, saves and explains what is shown', async () => {
    const user = userEvent.setup()
    const repo = await guestRepo('set-name')
    const update = vi.spyOn(repo, 'updateProfile')
    renderApp(repo, '/settings', { signedIn: true })
    const input = await screen.findByLabelText('Public name')
    expect(screen.getByText(/shown on plans you share/i).textContent).toMatch(/email is never shown/i)
    await user.type(input, 'a')
    await user.click(screen.getByRole('button', { name: 'Save public name' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/2 to 30/)
    await user.clear(input)
    await user.type(input, 'bad/name')
    await user.click(screen.getByRole('button', { name: 'Save public name' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/letters, digits, spaces/)
    expect(update).not.toHaveBeenCalled()
    await user.clear(input)
    await user.type(input, '  Sam Lifts ')
    await user.click(screen.getByRole('button', { name: 'Save public name' }))
    await waitFor(async () => expect((await repo.getProfile()).display_name).toBe('Sam Lifts'))
    expect(update).toHaveBeenCalledWith({ display_name: 'Sam Lifts' })
  })
})
