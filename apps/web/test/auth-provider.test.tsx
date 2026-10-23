import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProfileNotFoundError, UnauthenticatedError, OfflineError } from '@workout/shared'
import { expect, test, vi } from 'vitest'
import { AuthError, type AuthClient } from '../src/auth/client'
import { AuthProvider, useAuth } from '../src/auth/auth-provider'
import { useRepo } from '../src/repo/provider'

function makeLocal() {
  return { tag: 'local', init: vi.fn(async () => {}), exportAll: vi.fn(async () => ({ version: 1 })), reset: vi.fn(async () => {}) }
}
function makeApi(over: Record<string, unknown> = {}) {
  return {
    tag: 'api',
    init: vi.fn(async () => {}),
    getProfile: vi.fn(async () => ({ user_id: 'u' })),
    importAll: vi.fn(async () => {}),
    ...over,
  }
}
function makeAuth(session: AuthClient['session'], over: Partial<AuthClient> = {}): AuthClient {
  return {
    signUp: vi.fn(async () => ({ userId: 'u', email: 'a@b.co' })),
    signIn: vi.fn(async () => ({ userId: 'u', email: 'a@b.co' })),
    signOut: vi.fn(async () => {}),
    session,
    ...over,
  }
}

function Probe() {
  const a = useAuth()
  const repo = useRepo() as unknown as { tag: string }
  const q = useQuery({ queryKey: ['probe'], queryFn: async () => repo.tag })
  return (
    <div>
      <p data-testid="s">{`${a.status}|${repo.tag}|${a.pendingUpload}|${a.confirmingDiscard}|${a.error ?? ''}|${q.data ?? ''}`}</p>
      <button onClick={() => void a.signUp('a@b.co', 'longenough1')}>up</button>
      <button onClick={() => void a.signIn('a@b.co', 'longenough1')}>in</button>
      <button onClick={() => void a.signOut()}>out</button>
      <button onClick={() => void a.confirmDiscard()}>confirm</button>
      <button onClick={() => void a.cancelDiscard()}>cancel</button>
      <button onClick={() => void a.retryUpload()}>retry</button>
    </div>
  )
}

function setup(auth: AuthClient, local = makeLocal(), api = makeApi()) {
  const qc = new QueryClient()
  render(
    <QueryClientProvider client={qc}>
      <AuthProvider auth={auth} local={local as never} createApi={() => api as never}>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>,
  )
  return { qc, local, api }
}
const state = () => screen.getByTestId('s').textContent

test('renders nothing (no guest flash) while the session is loading', async () => {
  let resolve!: (v: null) => void
  setup(makeAuth(() => new Promise((r) => (resolve = r))))
  expect(screen.queryByTestId('s')).toBeNull()
  await act(async () => resolve(null))
  expect(await screen.findByTestId('s')).toBeTruthy()
  expect(state()).toMatch(/^guest\|local/)
})

test('an existing session with data starts on the API repo', async () => {
  setup(makeAuth(async () => ({ userId: 'u', email: 'a@b.co' })))
  await waitFor(() => expect(state()).toMatch(/^signed-in\|api/))
})

test('an existing session on an empty account keeps local data and offers upload retry', async () => {
  const api = makeApi({ getProfile: vi.fn(async () => { throw new ProfileNotFoundError() }) })
  setup(makeAuth(async () => ({ userId: 'u', email: 'a@b.co' })), makeLocal(), api)
  await waitFor(() => expect(state()).toMatch(/^signed-in\|local\|true/))
})

test('sign-up success switches to the API repo and clears the query cache', async () => {
  const user = userEvent.setup()
  const api = makeApi({ getProfile: vi.fn(async () => { throw new ProfileNotFoundError() }) })
  const { qc, local } = setup(makeAuth(async () => null), makeLocal(), api)
  await waitFor(() => expect(state()).toMatch(/\|local$/))
  await user.click(screen.getByText('up'))
  await waitFor(() => expect(state()).toMatch(/^signed-in\|api\|false\|false\|\|api$/))
  expect(local.reset).toHaveBeenCalled()
  expect(api.importAll).toHaveBeenCalledTimes(1)
  expect(qc.getQueryData(['probe'])).toBe('api')
})

test('upload failure leaves local data, shows pending upload, and can retry', async () => {
  const user = userEvent.setup()
  const importAll = vi.fn().mockRejectedValueOnce(new OfflineError()).mockResolvedValue(undefined)
  const api = makeApi({ importAll })
  const { local } = setup(makeAuth(async () => null), makeLocal(), api)
  await waitFor(() => expect(state()).toMatch(/^guest/))
  await user.click(screen.getByText('up'))
  await waitFor(() => expect(state()).toMatch(/^signed-in\|local\|true/))
  expect(local.reset).not.toHaveBeenCalled()
  await user.click(screen.getByText('retry'))
  await waitFor(() => expect(state()).toMatch(/^signed-in\|api\|false/))
  expect(local.reset).toHaveBeenCalledTimes(1)
})

test('sign-in with data waits for confirmation, cancel returns to guest', async () => {
  const user = userEvent.setup()
  const auth = makeAuth(async () => null)
  const { local } = setup(auth)
  await waitFor(() => expect(state()).toMatch(/^guest/))
  await user.click(screen.getByText('in'))
  await waitFor(() => expect(state()).toMatch(/^signed-in\|local\|false\|true/))
  await user.click(screen.getByText('cancel'))
  await waitFor(() => expect(state()).toMatch(/^guest\|local/))
  expect(auth.signOut).toHaveBeenCalled()
  expect(local.reset).not.toHaveBeenCalled()
})

test('confirming the discard switches to the API repo', async () => {
  const user = userEvent.setup()
  const { local } = setup(makeAuth(async () => null))
  await waitFor(() => expect(state()).toMatch(/^guest/))
  await user.click(screen.getByText('in'))
  await waitFor(() => expect(state()).toMatch(/\|true\|/))
  await user.click(screen.getByText('confirm'))
  await waitFor(() => expect(state()).toMatch(/^signed-in\|api\|false\|false/))
  expect(local.reset).toHaveBeenCalledTimes(1)
})

test('fail closed: a failed data-exists check keeps guest mode and reports it', async () => {
  const user = userEvent.setup()
  const api = makeApi({ getProfile: vi.fn(async () => { throw new OfflineError() }) })
  const { local } = setup(makeAuth(async () => null), makeLocal(), api)
  await waitFor(() => expect(state()).toMatch(/^guest/))
  await user.click(screen.getByText('in'))
  await waitFor(() => expect(state()).toMatch(/^guest\|local\|false\|false\|check_failed/))
  expect(local.reset).not.toHaveBeenCalled()
})

test('wrong credentials surface a typed error and stay guest', async () => {
  const user = userEvent.setup()
  const auth = makeAuth(async () => null, { signIn: vi.fn(async () => { throw new AuthError('invalid_credentials') }) })
  setup(auth)
  await waitFor(() => expect(state()).toMatch(/^guest/))
  await user.click(screen.getByText('in'))
  await waitFor(() => expect(state()).toMatch(/invalid_credentials/))
})

test('double submit only runs the flow once', async () => {
  const user = userEvent.setup()
  let release!: () => void
  const signIn = vi.fn(() => new Promise<{ userId: string; email: string }>((r) => (release = () => r({ userId: 'u', email: 'a@b.co' }))))
  setup(makeAuth(async () => null, { signIn }))
  await waitFor(() => expect(state()).toMatch(/^guest/))
  await user.click(screen.getByText('in'))
  await user.click(screen.getByText('in'))
  expect(signIn).toHaveBeenCalledTimes(1)
  await act(async () => release())
})

test('sign-out returns to a fresh guest DB and clears the cache', async () => {
  const user = userEvent.setup()
  const { qc, local } = setup(makeAuth(async () => ({ userId: 'u', email: 'a@b.co' })))
  await waitFor(() => expect(state()).toMatch(/^signed-in\|api/))
  await user.click(screen.getByText('out'))
  await waitFor(() => expect(state()).toMatch(/^guest\|local\|false\|false\|\|local$/))
  expect(local.reset).toHaveBeenCalled()
  expect(qc.getQueryData(['probe'])).toBe('local')
})

test('a 401 mid-use shows the signed-out prompt, never guest data', async () => {
  const api = makeApi()
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Failing() {
    useQuery({ queryKey: ['boom'], queryFn: async () => { throw new UnauthenticatedError() } })
    return null
  }
  render(
    <QueryClientProvider client={qc}>
      <AuthProvider auth={makeAuth(async () => ({ userId: 'u', email: 'a@b.co' }))} local={makeLocal() as never} createApi={() => api as never}>
        <Probe />
        <Failing />
      </AuthProvider>
    </QueryClientProvider>,
  )
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(screen.getByText(/signed out/i)).toBeTruthy()
  expect(screen.queryByTestId('s')).toBeNull()
})

test('offline at startup with a signed-in hint does not fall back to guest', async () => {
  localStorage.setItem('wt-account-hint', '1')
  setup(makeAuth(async () => { throw new AuthError('offline') }))
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(screen.queryByTestId('s')).toBeNull()
  localStorage.removeItem('wt-account-hint')
})
