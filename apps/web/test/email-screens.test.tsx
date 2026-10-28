import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'
import { AuthProvider } from '../src/auth/auth-provider'
import { AuthError, type AuthClient } from '../src/auth/client'
import { routes } from '../src/app/router'

afterEach(() => localStorage.clear())

function setup(url: string, over: Partial<AuthClient> = {}, session = false) {
  const auth: AuthClient = {
    signUp: vi.fn(async () => ({ userId: '', email: '' })),
    signIn: vi.fn(async () => ({ userId: 'u', email: 'a@example.com' })),
    signOut: vi.fn(async () => {}),
    session: async () => (session ? { userId: 'u', email: 'me@example.test' } : null),
    resendSetupLink: vi.fn(async () => {}),
    requestPasswordReset: vi.fn(async () => {}),
    resetPassword: vi.fn(async () => {}),
    deleteAccount: vi.fn(async () => {}),
    ...over,
  }
  const local = { init: async () => {}, exportAll: async () => ({}), reset: async () => {} }
  const api = { init: async () => {}, getProfile: async () => ({ user_id: 'u' }) }
  const router = createMemoryRouter(routes, { initialEntries: [url] })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthProvider auth={auth} local={local as never} createApi={() => api as never}>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  )
  return { auth, router }
}

test('the old /verified page is gone and an unknown page says so with a way home', async () => {
  for (const url of ['/verified', '/verified?error=TOKEN_EXPIRED', '/no-such-page']) {
    setup(url)
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeTruthy()
    expect(screen.queryByText(/email confirmed/i)).toBeNull()
    const home = screen.getByRole('link', { name: 'Go to Today' })
    expect(home.getAttribute('href')).toBe('/')
    expect(home.className).toContain('min-h-11')
    cleanup()
  }
})

test('a set-up link (?setup=1) reads "Choose your password", removes token and flag from the address bar, ends on "Password set"', async () => {
  const user = userEvent.setup()
  const { auth, router } = setup('/reset-password?token=setup123&setup=1')
  expect(await screen.findByRole('heading', { name: 'Choose your password' })).toBeTruthy()
  expect(screen.queryByText(/reset password/i)).toBeNull()
  await waitFor(() => expect(router.state.location.search).toBe(''))
  const field = screen.getByLabelText('Password')
  expect(field.getAttribute('autocomplete')).toBe('new-password')
  await user.type(field, 'my chosen password')
  await user.click(screen.getByRole('button', { name: 'Set password' }))
  expect((await screen.findByRole('status')).textContent).toBe('Password set. Sign in to continue.')
  expect(auth.resetPassword).toHaveBeenCalledWith('setup123', 'my chosen password')
  const signIn = screen.getByRole('link', { name: 'Sign in' })
  expect(signIn.getAttribute('href')).toBe('/settings')
  expect(signIn.className).toContain('min-h-11')
})

test('an expired set-up link offers a new set-up link (through request-password-reset)', async () => {
  const user = userEvent.setup()
  const { auth } = setup('/reset-password?token=old&setup=1', { resetPassword: vi.fn(async () => { throw new AuthError('invalid_token') }) })
  await user.type(await screen.findByLabelText('Password'), 'my chosen password')
  await user.click(screen.getByRole('button', { name: 'Set password' }))
  expect((await screen.findByRole('alert')).textContent).toBe('This link has expired. Request a new one.')
  await user.type(screen.getByLabelText('Email'), 'a@example.com')
  await user.click(screen.getByRole('button', { name: 'Send a new link' }))
  expect((await screen.findByRole('status')).textContent).toMatch(/new link/i)
  expect(auth.resendSetupLink).toHaveBeenCalledWith('a@example.com')
})

test('reset screen removes the token from the address bar and submits it once', async () => {
  const user = userEvent.setup()
  const { auth, router } = setup('/reset-password?token=abc123')
  const field = await screen.findByLabelText('New password')
  expect(screen.getByRole('heading', { name: 'Reset password' })).toBeTruthy()
  await waitFor(() => expect(router.state.location.search).toBe(''))
  expect(field.getAttribute('type')).toBe('password')
  expect(field.getAttribute('autocomplete')).toBe('new-password')
  await user.type(field, 'short')
  await user.click(screen.getByRole('button', { name: 'Change password' }))
  expect((await screen.findByRole('alert')).textContent).toMatch(/10 to 128/)
  expect(auth.resetPassword).not.toHaveBeenCalled()
  const toggle = screen.getByRole('button', { name: 'Show password' })
  expect(toggle.className).toContain('min-h-11')
  await user.click(toggle)
  expect(field.getAttribute('type')).toBe('text')
  await user.clear(field)
  await user.type(field, 'brand-new-pass1')
  await user.click(screen.getByRole('button', { name: 'Change password' }))
  await screen.findByText(/password changed/i)
  expect(auth.resetPassword).toHaveBeenCalledWith('abc123', 'brand-new-pass1')
  expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/settings')
})

test('reset screen: invalid token at submit shows the expired message and the request form', async () => {
  const user = userEvent.setup()
  setup('/reset-password?token=old', { resetPassword: vi.fn(async () => { throw new AuthError('invalid_token') }) })
  await user.type(await screen.findByLabelText('New password'), 'brand-new-pass1')
  await user.click(screen.getByRole('button', { name: 'Change password' }))
  expect((await screen.findByRole('alert')).textContent).toBe('This link has expired. Request a new one.')
  expect(screen.getByRole('button', { name: 'Send reset link' })).toBeTruthy()
})

test('reset screen without a token shows the expired message; works signed in', async () => {
  setup('/reset-password', {}, true)
  expect((await screen.findByRole('alert')).textContent).toBe('This link has expired. Request a new one.')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send reset link' })).toBeTruthy())
})
