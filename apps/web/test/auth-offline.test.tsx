import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { AuthError, type AuthClient } from '../src/auth/client'
import { AuthProvider, useAuth } from '../src/auth/auth-provider'
import { AccountCard } from '../src/components/account-card'
import { useRepo } from '../src/repo/provider'
import type { OfflineState } from '../src/repo/offline'

afterEach(() => localStorage.clear())

function makeLocal() {
  return { tag: 'local', init: vi.fn(async () => {}), exportAll: vi.fn(async () => ({ version: 1 })), reset: vi.fn(async () => {}) }
}
function makeOfflineApi(id: string, o: { pending?: number; hasData?: boolean } = {}) {
  let cb: ((s: OfflineState) => void) | null = null
  let pending = o.pending ?? 0
  return {
    id,
    tag: `api:${id}`,
    init: vi.fn(async () => {}),
    getProfile: vi.fn(async () => ({ user_id: id })),
    importAll: vi.fn(async () => {}),
    ready: Promise.resolve(),
    pending: () => pending,
    paused: () => false,
    flush: vi.fn(async () => {}),
    resume: vi.fn(),
    pause: vi.fn(),
    clear: vi.fn(async () => { pending = 0 }),
    dispose: vi.fn(),
    hasOfflineData: vi.fn(async () => o.hasData ?? false),
    subscribe: (f: (s: OfflineState) => void) => {
      cb = f
      return () => { cb = null }
    },
    emit: (s: Partial<OfflineState>) => cb?.({ pending, paused: false, version: 0, ...s }),
  }
}
function makeAuth(session: AuthClient['session'], over: Partial<AuthClient> = {}): AuthClient {
  return {
    signUp: vi.fn(async () => ({ userId: 'a', email: 'a@example.com' })),
    signIn: vi.fn(async () => ({ userId: 'a', email: 'a@example.com' })),
    signOut: vi.fn(async () => {}),
    resendVerification: vi.fn(async () => {}),
    requestPasswordReset: vi.fn(async () => {}),
    resetPassword: vi.fn(async () => {}),
    deleteAccount: vi.fn(async () => {}),
    session,
    ...over,
  }
}
function Probe() {
  const a = useAuth()
  const repo = useRepo() as unknown as { tag: string }
  return (
    <div>
      <p data-testid="s">{`${a.status}|${repo.tag}|${a.pendingChanges}|${a.error ?? ''}`}</p>
      <button onClick={() => void a.signOut()}>out</button>
      <button onClick={() => void a.signOut({ discardPending: true })}>out-force</button>
      <button onClick={() => void a.signIn('a@example.com', 'longenough1')}>in</button>
    </div>
  )
}
function setup(auth: AuthClient, createApi: (id: string) => unknown, child: React.ReactNode = <Probe />) {
  const local = makeLocal()
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AuthProvider auth={auth} local={local as never} createApi={createApi as never}>
        {child}
      </AuthProvider>
    </QueryClientProvider>,
  )
  return local
}
const state = () => screen.getByTestId('s').textContent

test('offline at startup opens the mirrored view for the hinted account instead of a Retry prompt', async () => {
  localStorage.setItem('wt-account-hint', JSON.stringify({ id: 'a', email: 'a@example.com' }))
  const api = makeOfflineApi('a', { hasData: true })
  const create = vi.fn(() => api)
  setup(makeAuth(async () => { throw new AuthError('offline') }), create)
  expect(await screen.findByTestId('s')).toBeTruthy()
  expect(state()).toMatch(/^signed-in\|api:a/)
  expect(create).toHaveBeenCalledWith('a')
})

test('offline at startup with nothing mirrored still shows Retry, never guest', async () => {
  localStorage.setItem('wt-account-hint', JSON.stringify({ id: 'a', email: 'a@example.com' }))
  setup(makeAuth(async () => { throw new AuthError('offline') }), () => makeOfflineApi('a', { hasData: false }))
  expect(await screen.findByRole('button', { name: 'Retry' })).toBeTruthy()
  expect(screen.queryByTestId('s')).toBeNull()
})

test('a replay that hits 401 sends the app to the signed-out prompt', async () => {
  const api = makeOfflineApi('a', { pending: 1 })
  setup(makeAuth(async () => ({ userId: 'a', email: 'a@example.com' })), () => api)
  await screen.findByTestId('s')
  act(() => api.emit({ paused: true }))
  expect(await screen.findByText(/signed out/i)).toBeTruthy()
})

test('signing out with unsent edits needs an explicit discard; then the queue is cleared', async () => {
  const api = makeOfflineApi('a', { pending: 2 })
  const auth = makeAuth(async () => ({ userId: 'a', email: 'a@example.com' }))
  const local = setup(auth, () => api)
  const user = userEvent.setup()
  await screen.findByTestId('s')
  await user.click(screen.getByText('out'))
  await waitFor(() => expect(state()).toMatch(/unsynced_changes/))
  expect(api.flush).toHaveBeenCalled() // tried to send them first
  expect(auth.signOut).not.toHaveBeenCalled()
  expect(api.clear).not.toHaveBeenCalled()
  await user.click(screen.getByText('out-force'))
  await waitFor(() => expect(state()).toMatch(/^guest\|local/))
  expect(auth.signOut).toHaveBeenCalled()
  expect(api.clear).toHaveBeenCalled()
  expect(local.reset).toHaveBeenCalled()
})

test('a failed server sign-out leaves the queue alone', async () => {
  const api = makeOfflineApi('a', { pending: 2 })
  const auth = makeAuth(async () => ({ userId: 'a', email: 'a@example.com' }), { signOut: vi.fn(async () => { throw new AuthError('offline') }) })
  setup(auth, () => api)
  const user = userEvent.setup()
  await screen.findByTestId('s')
  await user.click(screen.getByText('out-force'))
  await waitFor(() => expect(state()).toMatch(/offline/))
  expect(api.clear).not.toHaveBeenCalled()
})

async function expire(api: ReturnType<typeof makeOfflineApi>) {
  await screen.findByTestId('s')
  act(() => api.emit({ paused: true }))
  await screen.findByText(/signed out/i)
}

test('re-signing in as the same account resumes the paused queue', async () => {
  const api = makeOfflineApi('a', { pending: 1 })
  const create = vi.fn(() => api)
  const auth = makeAuth(async () => ({ userId: 'a', email: 'a@example.com' }))
  setup(auth, create, <Probe />)
  await expire(api)
  const user = userEvent.setup()
  await user.type(screen.getByLabelText(/email/i), 'a@example.com')
  await user.type(screen.getByLabelText(/password/i), 'longenough1')
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
  await screen.findByTestId('s')
  expect(api.resume).toHaveBeenCalled()
  expect(create).toHaveBeenCalledTimes(1)
})

test("re-signing in as a different account never resumes or replays the old account's queue", async () => {
  const apiA = makeOfflineApi('a', { pending: 1 })
  const apiB = makeOfflineApi('b')
  const create = vi.fn((id: string) => (id === 'a' ? apiA : apiB))
  const auth = makeAuth(async () => ({ userId: 'a', email: 'a@example.com' }), {
    signIn: vi.fn(async () => ({ userId: 'b', email: 'b@example.com' })),
  })
  setup(auth, create)
  await expire(apiA)
  const user = userEvent.setup()
  await user.type(screen.getByLabelText(/email/i), 'b@example.com')
  await user.type(screen.getByLabelText(/password/i), 'longenough1')
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
  await screen.findByTestId('s')
  expect(state()).toMatch(/^signed-in\|api:b\|0/)
  expect(apiA.resume).not.toHaveBeenCalled()
  expect(apiA.dispose).toHaveBeenCalled()
  expect(apiA.clear).not.toHaveBeenCalled() // A's unsent edits are kept for A
  expect(create).toHaveBeenCalledWith('b')
})

test('"Use guest mode instead" with unsent edits asks first', async () => {
  const api = makeOfflineApi('a', { pending: 3 })
  const auth = makeAuth(async () => ({ userId: 'a', email: 'a@example.com' }))
  setup(auth, () => api)
  await expire(api)
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Use guest mode instead' }))
  expect(screen.getByText(/3 unsent changes/i)).toBeTruthy()
  expect(auth.signOut).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Discard changes and use guest mode' }))
  await waitFor(() => expect(api.clear).toHaveBeenCalled())
})

test('the account card warns about unsent edits before signing out', async () => {
  const api = makeOfflineApi('a', { pending: 2 })
  const auth = makeAuth(async () => ({ userId: 'a', email: 'a@example.com' }))
  setup(auth, () => api, <AccountCard />)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Sign out' }))
  expect(screen.getByText(/2 changes that haven't reached the server/i)).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Confirm sign out' }))
  await waitFor(() => expect(api.clear).toHaveBeenCalled())
  expect(auth.signOut).toHaveBeenCalled()
})
