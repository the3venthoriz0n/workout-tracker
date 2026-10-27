import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AlreadyHasDataError, ProfileNotFoundError } from '@workout/shared'
import { afterEach, expect, test, vi } from 'vitest'
import { AuthError, type AuthClient } from '../src/auth/client'
import { AuthProvider, useAuth } from '../src/auth/auth-provider'
import { useRepo } from '../src/repo/provider'
import { cancelDiscard, signInFlow } from '../src/auth/import-flow'

afterEach(() => localStorage.clear())
const HINT = 'wt-account-hint'

function makeLocal() {
  return { tag: 'local', init: vi.fn(async () => {}), exportAll: vi.fn(async () => ({ version: 1 })), reset: vi.fn(async () => {}) }
}
function makeAuth(over: Partial<AuthClient> = {}): AuthClient {
  return {
    signUp: vi.fn(async () => ({ userId: 'a', email: 'a@example.com' })),
    signIn: vi.fn(async () => ({ userId: 'a', email: 'a@example.com' })),
    signOut: vi.fn(async () => {}),
    resendVerification: vi.fn(async () => {}),
    requestPasswordReset: vi.fn(async () => {}),
    resetPassword: vi.fn(async () => {}),
    session: async () => ({ userId: 'a', email: 'a@example.com' }),
    ...over,
  }
}
function Probe() {
  const a = useAuth()
  const repo = useRepo() as unknown as { tag: string }
  return (
    <div>
      <p data-testid="s">{`${a.status}|${repo.tag}|up=${a.pendingUpload}|cd=${a.confirmingDiscard}|${a.error ?? ''}`}</p>
      <button onClick={() => void a.signOut()}>out</button>
      <button onClick={() => void a.signIn('a@example.com', 'longenough1')}>in</button>
      <button onClick={() => void a.cancelDiscard()}>cancel</button>
      <button onClick={() => void a.confirmDiscard()}>confirm</button>
    </div>
  )
}
function setup(auth: AuthClient, api: Record<string, unknown> = {}) {
  const local = makeLocal()
  const fullApi = { tag: 'api', init: async () => {}, getProfile: async () => ({}), importAll: async () => {}, ...api }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthProvider auth={auth} local={local as never} createApi={() => fullApi as never}>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>,
  )
  return local
}
const state = () => screen.getByTestId('s').textContent

test('reloading mid-prompt re-shows the discard prompt, and signing out without confirming does not wipe guest data', async () => {
  localStorage.setItem(HINT, JSON.stringify({ id: 'a', email: 'a@example.com', phase: 'confirm-discard' }))
  const auth = makeAuth()
  const local = setup(auth)
  await screen.findByTestId('s')
  expect(state()).toMatch(/^signed-in\|local\|up=false\|cd=true/)
  await userEvent.setup().click(screen.getByText('out'))
  await waitFor(() => expect(state()).toMatch(/^guest/))
  expect(auth.signOut).toHaveBeenCalled()
  expect(local.reset).not.toHaveBeenCalled()
})

test('reloading with an unfinished upload re-shows the retry state and keeps guest data', async () => {
  localStorage.setItem(HINT, JSON.stringify({ id: 'a', email: 'a@example.com', phase: 'pending-upload' }))
  const local = setup(makeAuth())
  await screen.findByTestId('s')
  expect(state()).toMatch(/^signed-in\|local\|up=true/)
  expect(local.reset).not.toHaveBeenCalled()
})

test('the phase is persisted when the prompt appears and removed once confirmed', async () => {
  const auth = makeAuth({ session: async () => null })
  setup(auth)
  const user = userEvent.setup()
  await screen.findByTestId('s')
  await user.click(screen.getByText('in')) // account has data -> confirm-discard
  await waitFor(() => expect(state()).toMatch(/cd=true/))
  expect(JSON.parse(localStorage.getItem(HINT)!)).toMatchObject({ id: 'a', phase: 'confirm-discard' })
  await user.click(screen.getByText('confirm'))
  await waitFor(() => expect(state()).toMatch(/cd=false/))
  expect(JSON.parse(localStorage.getItem(HINT)!).phase).toBeUndefined()
})

test('cancel only returns to guest once the server sign-out succeeded', async () => {
  const auth = makeAuth({ session: async () => null })
  setup(auth)
  const user = userEvent.setup()
  await screen.findByTestId('s')
  await user.click(screen.getByText('in'))
  await waitFor(() => expect(state()).toMatch(/cd=true/))
  vi.mocked(auth.signOut).mockRejectedValueOnce(new AuthError('offline'))
  await user.click(screen.getByText('cancel'))
  await waitFor(() => expect(state()).toMatch(/cd=true\|offline/))
  expect(JSON.parse(localStorage.getItem(HINT)!).phase).toBe('confirm-discard')
  await user.click(screen.getByText('cancel'))
  await waitFor(() => expect(state()).toMatch(/^guest/))
})

test('offline cold start with an unfinished prompt does not open the account view', async () => {
  localStorage.setItem(HINT, JSON.stringify({ id: 'a', email: 'a@example.com', phase: 'confirm-discard' }))
  setup(makeAuth({ session: async () => { throw new AuthError('offline') } }))
  expect(await screen.findByRole('button', { name: 'Retry' })).toBeTruthy()
})

test('flow: a failed sign-out cleanup after check_failed keeps the retry state instead of pretending to be guest', async () => {
  const d = {
    auth: {
      signIn: vi.fn(async () => ({ userId: 'a', email: 'a@example.com' })),
      signOut: vi.fn(async () => { throw new AuthError('offline') }),
      signUp: vi.fn(),
      session: vi.fn(),
      resendVerification: vi.fn(),
      requestPasswordReset: vi.fn(),
      resetPassword: vi.fn(),
    },
    local: { exportAll: vi.fn(), reset: vi.fn() },
    api: { getProfile: vi.fn(async () => { throw new Error('boom') }), importAll: vi.fn() },
  }
  expect(await signInFlow(d as never, 'a@example.com', 'longenough1')).toBe('upload-failed')
  expect(d.local.reset).not.toHaveBeenCalled()
  void ProfileNotFoundError
  void AlreadyHasDataError
})

test('flow: cancelDiscard surfaces a failed sign-out', async () => {
  const d = { auth: { signOut: vi.fn(async () => { throw new AuthError('offline') }) }, local: {}, api: {} }
  await expect(cancelDiscard(d as never)).rejects.toBeInstanceOf(AuthError)
})

test("the previous account's repo is paused before another sign-in is attempted", async () => {
  const order: string[] = []
  const api = {
    tag: 'api', init: async () => {}, getProfile: async () => ({}), importAll: async () => {},
    ready: Promise.resolve(), pending: () => 1, paused: () => false, flush: async () => {}, resume: () => {},
    clear: async () => {}, dispose: () => {}, hasOfflineData: async () => true,
    pause: () => order.push('pause'), subscribe: () => () => {},
  }
  localStorage.setItem(HINT, JSON.stringify({ id: 'a', email: 'a@example.com' }))
  const auth = makeAuth({
    session: async () => { throw new AuthError('offline') },
    signIn: vi.fn(async () => { order.push('signIn'); return { userId: 'b', email: 'b@example.com' } }),
  })
  const local = makeLocal()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthProvider auth={auth} local={local as never} createApi={() => api as never}>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>,
  )
  await screen.findByTestId('s')
  await userEvent.setup().click(screen.getByText('in'))
  await waitFor(() => expect(order).toContain('signIn'))
  expect(order).toContain('pause')
  expect(order.indexOf('pause')).toBeLessThan(order.indexOf('signIn'))
})
