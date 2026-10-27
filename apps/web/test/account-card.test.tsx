import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProfileNotFoundError, OfflineError } from '@workout/shared'
import { expect, test, vi } from 'vitest'
import { AuthError, type AuthClient } from '../src/auth/client'
import { AuthProvider } from '../src/auth/auth-provider'
import { AccountCard } from '../src/components/account-card'

function setup(opts: { session?: boolean; signIn?: AuthClient['signIn']; signUp?: AuthClient['signUp']; profile?: () => Promise<unknown>; importAll?: () => Promise<void>; signOut?: AuthClient['signOut']; resend?: AuthClient['resendVerification']; forgot?: AuthClient['requestPasswordReset'] } = {}) {
  const auth: AuthClient = {
    signUp: opts.signUp ?? vi.fn(async () => ({ userId: 'u', email: 'a@example.com' })),
    signIn: opts.signIn ?? vi.fn(async () => ({ userId: 'u', email: 'a@example.com' })),
    signOut: opts.signOut ?? vi.fn(async () => {}),
    resendVerification: opts.resend ?? vi.fn(async () => {}),
    requestPasswordReset: opts.forgot ?? vi.fn(async () => {}),
    resetPassword: vi.fn(async () => {}),
    deleteAccount: vi.fn(async () => {}),
    session: async () => (opts.session ? { userId: 'u', email: 'me@example.test' } : null),
  }
  const local = { init: async () => {}, exportAll: vi.fn(async () => ({ version: 1 })), reset: vi.fn(async () => {}) }
  const api = {
    init: async () => {},
    getProfile: opts.profile ?? (async () => ({ user_id: 'u' })),
    importAll: opts.importAll ?? (async () => {}),
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthProvider auth={auth} local={local as never} createApi={() => api as never}>
        <AccountCard />
      </AuthProvider>
    </QueryClientProvider>,
  )
  return { auth, local }
}
async function fill(user: ReturnType<typeof userEvent.setup>, email: string, pw: string) {
  await user.type(screen.getByLabelText('Email'), email)
  await user.type(screen.getByLabelText('Password'), pw)
}

test('guest state has labelled fields and 44px targets; validates before sending', async () => {
  const user = userEvent.setup()
  const { auth } = setup()
  const submit = await screen.findByRole('button', { name: 'Sign in' })
  expect(submit.className).toContain('min-h-11')
  expect(screen.getByLabelText('Password').getAttribute('autocomplete')).toBe('current-password')
  await fill(user, 'not-an-email', 'longenough1')
  await user.click(submit)
  expect((await screen.findByRole('alert')).textContent).toMatch(/valid email/i)
  await user.clear(screen.getByLabelText('Email'))
  await user.type(screen.getByLabelText('Email'), 'a@example.com')
  await user.clear(screen.getByLabelText('Password'))
  await user.type(screen.getByLabelText('Password'), 'short')
  await user.click(submit)
  expect((await screen.findByRole('alert')).textContent).toMatch(/10.*128/)
  expect(auth.signIn).not.toHaveBeenCalled()
})

test('wrong credentials show a generic message', async () => {
  const user = userEvent.setup()
  setup({ signIn: vi.fn(async () => { throw new AuthError('invalid_credentials') }) })
  await screen.findByRole('button', { name: 'Sign in' })
  await fill(user, 'a@example.com', 'longenough1')
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
  expect((await screen.findByRole('alert')).textContent).toBe('Email or password is incorrect.')
})

test.each([
  ['rate_limited', /too many attempts/i],
  ['offline', /can.t reach the server/i],
])('%s error text', async (kind, re) => {
  const user = userEvent.setup()
  setup({ signIn: vi.fn(async () => { throw new AuthError(kind as never) }) })
  await screen.findByRole('button', { name: 'Sign in' })
  await fill(user, 'a@example.com', 'longenough1')
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
  expect((await screen.findByRole('alert')).textContent).toMatch(re)
})

test('sign-up shows check your email, keeps guest data, and does not upload', async () => {
  const user = userEvent.setup()
  const importAll = vi.fn(async () => {})
  const { local, auth } = setup({ importAll })
  await user.click(await screen.findByRole('tab', { name: 'Sign up' }))
  expect(screen.getByLabelText('Password').getAttribute('autocomplete')).toBe('new-password')
  await fill(user, 'a@example.com', 'longenough1')
  await user.click(screen.getByRole('button', { name: 'Create account' }))
  expect(await screen.findByText('Check your email')).toBeTruthy()
  expect(screen.getByText(/finish setting up your account/i)).toBeTruthy()
  expect(screen.getByText('a@example.com')).toBeTruthy()
  expect(auth.signUp).toHaveBeenCalledTimes(1)
  expect(importAll).not.toHaveBeenCalled()
  expect(local.exportAll).not.toHaveBeenCalled()
  expect(local.reset).not.toHaveBeenCalled()
})

test('check your email: resend is disabled for 30 seconds, use a different email returns to the form', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  try {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const resend = vi.fn(async () => {})
    setup({ resend })
    await user.click(await screen.findByRole('tab', { name: 'Sign up' }))
    await fill(user, 'a@example.com', 'longenough1')
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    const btn = await screen.findByRole('button', { name: 'Resend email' })
    expect(btn.className).toContain('min-h-11')
    await user.click(btn)
    expect(resend).toHaveBeenCalledWith('a@example.com')
    expect((screen.getByRole('button', { name: /resend email/i }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('status').textContent).toMatch(/new link/i)
    await act(async () => { vi.advanceTimersByTime(30_000) })
    expect((screen.getByRole('button', { name: 'Resend email' }) as HTMLButtonElement).disabled).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Use a different email' }))
    expect(await screen.findByRole('button', { name: 'Create account' })).toBeTruthy()
  } finally {
    vi.useRealTimers()
  }
})

test('first sign-in after verifying uploads the guest data', async () => {
  const user = userEvent.setup()
  const importAll = vi.fn(async () => {})
  const { local } = setup({ profile: async () => { throw new ProfileNotFoundError() }, importAll })
  await screen.findByRole('button', { name: 'Sign in' })
  await fill(user, 'a@example.com', 'longenough1')
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
  await waitFor(() => expect(screen.getByText(/signed in as/i)).toBeTruthy())
  expect(importAll).toHaveBeenCalledTimes(1)
  expect(local.reset).toHaveBeenCalledTimes(1)
})

test('unverified sign-in explains and offers a resend', async () => {
  const user = userEvent.setup()
  const resend = vi.fn(async () => {})
  const { local } = setup({ signIn: vi.fn(async () => { throw new AuthError('email_not_verified') }), resend })
  await screen.findByRole('button', { name: 'Sign in' })
  await fill(user, 'a@example.com', 'longenough1')
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
  expect((await screen.findByRole('alert')).textContent).toMatch(/confirm your email/i)
  await user.click(screen.getByRole('button', { name: 'Resend email' }))
  expect(resend).toHaveBeenCalledWith('a@example.com')
  expect(local.reset).not.toHaveBeenCalled()
})

test('forgot password always ends on the same sentence', async () => {
  const user = userEvent.setup()
  const forgot = vi.fn(async () => {})
  setup({ forgot })
  await user.click(await screen.findByRole('button', { name: 'Forgot password?' }))
  await user.type(screen.getByLabelText('Email'), 'nobody@example.com')
  await user.click(screen.getByRole('button', { name: 'Send reset link' }))
  expect((await screen.findByRole('status')).textContent).toBe('If that address has an account, we sent a link.')
  expect(forgot).toHaveBeenCalledWith('nobody@example.com')
})

test('forgot password validates the email and reports a rate limit', async () => {
  const user = userEvent.setup()
  const forgot = vi.fn(async () => { throw new AuthError('rate_limited') })
  setup({ forgot })
  await user.click(await screen.findByRole('button', { name: 'Forgot password?' }))
  await user.click(screen.getByRole('button', { name: 'Send reset link' }))
  expect((await screen.findByRole('alert')).textContent).toMatch(/valid email/i)
  expect(forgot).not.toHaveBeenCalled()
  await user.type(screen.getByLabelText('Email'), 'a@example.com')
  await user.click(screen.getByRole('button', { name: 'Send reset link' }))
  expect((await screen.findByRole('alert')).textContent).toMatch(/too many attempts/i)
  await user.click(screen.getByRole('button', { name: 'Back to sign in' }))
  expect(await screen.findByRole('button', { name: 'Sign in' })).toBeTruthy()
})

test('sign-in with existing data: confirm dialog offers export, cancel keeps guest', async () => {
  const user = userEvent.setup()
  const { local } = setup()
  await screen.findByRole('button', { name: 'Sign in' })
  await fill(user, 'a@example.com', 'longenough1')
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(dialog.textContent).toMatch(/discard/i)
  expect(screen.getByRole('button', { name: 'Export guest data first' })).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  await screen.findByRole('button', { name: 'Sign in' })
  expect(local.reset).not.toHaveBeenCalled()
})

test('confirming discards and shows the signed-in state', async () => {
  const user = userEvent.setup()
  const { local } = setup()
  await screen.findByRole('button', { name: 'Sign in' })
  await fill(user, 'a@example.com', 'longenough1')
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
  await user.click(await screen.findByRole('button', { name: 'Discard guest data and continue' }))
  await waitFor(() => expect(screen.getByText(/signed in as/i)).toBeTruthy())
  expect(local.reset).toHaveBeenCalledTimes(1)
})

test('signed-in state shows email and sign out asks for confirmation', async () => {
  const user = userEvent.setup()
  const { auth, local } = setup({ session: true })
  expect(await screen.findByText('me@example.test')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Sign out' }))
  expect(auth.signOut).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Confirm sign out' }))
  await waitFor(() => expect(auth.signOut).toHaveBeenCalled())
  await screen.findByRole('button', { name: 'Sign in' })
  expect(local.reset).toHaveBeenCalled()
})

test('submit button is disabled while a request is in flight', async () => {
  const user = userEvent.setup()
  const signIn = vi.fn(() => new Promise<never>(() => {}))
  setup({ signIn })
  await screen.findByRole('button', { name: 'Sign in' })
  await fill(user, 'a@example.com', 'longenough1')
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
  await waitFor(() => expect((screen.getByRole('button', { name: /signing in/i }) as HTMLButtonElement).disabled).toBe(true))
})
