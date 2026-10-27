import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
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
    resendVerification: vi.fn(async () => {}),
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

test('verified screen: success', async () => {
  setup('/verified')
  expect(await screen.findByText('Email confirmed. Sign in to continue.')).toBeTruthy()
  const link = screen.getByRole('link', { name: 'Sign in' })
  expect(link.getAttribute('href')).toBe('/settings')
  expect(link.className).toContain('min-h-11')
})

test.each([
  ['TOKEN_EXPIRED', /link has expired/i],
  ['INVALID_TOKEN', /isn.t valid or was already used/i],
  ['SOMETHING', /isn.t valid or was already used/i],
])('verified screen handles error=%s and offers a new link', async (code, re) => {
  const user = userEvent.setup()
  const { auth } = setup(`/verified?error=${code}`)
  expect((await screen.findByRole('alert')).textContent).toMatch(re)
  expect(screen.queryByText('Email confirmed. Sign in to continue.')).toBeNull()
  await user.type(screen.getByLabelText('Email'), 'a@example.com')
  await user.click(screen.getByRole('button', { name: 'Send a new link' }))
  expect((await screen.findByRole('status')).textContent).toMatch(/new link/i)
  expect(auth.resendVerification).toHaveBeenCalledWith('a@example.com')
})

test('reset screen removes the token from the address bar and submits it once', async () => {
  const user = userEvent.setup()
  const { auth, router } = setup('/reset-password?token=abc123')
  const field = await screen.findByLabelText('New password')
  expect(router.state.location.search).toBe('')
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
