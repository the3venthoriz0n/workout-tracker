// Settings > Delete account (spec §8): password + typing DELETE; on success nothing of the account
// stays on the device (query cache, outbox and mirror, account hint) and the app is a fresh guest.
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { UnauthenticatedError } from '@workout/shared'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { afterEach, expect, test, vi } from 'vitest'
import { AuthError, type AuthClient } from '../src/auth/client'
import { AuthProvider, useAuth } from '../src/auth/auth-provider'
import { useSignedIn } from '../src/auth/context'
import { DeleteAccountCard } from '../src/components/delete-account-card'
import { AppDb } from '../src/repo/db'
import { LocalRepo } from '../src/repo/local-repo'
import { useRepo } from '../src/repo/provider'

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

function makeApi(id: string) {
  return {
    tag: `api:${id}`,
    init: vi.fn(async () => {}),
    getProfile: vi.fn(async () => ({ user_id: id })),
    importAll: vi.fn(async () => {}),
    exportAll: vi.fn(async () => ({ version: 1, account: { email: 'me@example.test' } })),
    ready: Promise.resolve(),
    pending: () => 2,
    paused: () => false,
    flush: vi.fn(async () => {}),
    resume: vi.fn(),
    pause: vi.fn(),
    clear: vi.fn(async () => {}),
    dispose: vi.fn(),
    hasOfflineData: vi.fn(async () => false),
    subscribe: () => () => undefined,
  }
}

function makeAuth(over: Partial<AuthClient> = {}): AuthClient {
  let signedIn = true
  return {
    signUp: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(async () => {}),
    resendVerification: vi.fn(),
    requestPasswordReset: vi.fn(),
    resetPassword: vi.fn(),
    deleteAccount: vi.fn(async () => {
      signedIn = false
    }),
    session: async () => (signedIn ? { userId: 'acc-1', email: 'me@example.test' } : null),
    ...over,
  }
}

function Probe() {
  const a = useAuth()
  const repo = useRepo() as unknown as { tag?: string }
  return <p data-testid="s">{`${a.status}|${repo.tag ?? 'local'}`}</p>
}

/** As in Settings: the card only exists while signed in. */
function Gate() {
  return useSignedIn() ? <DeleteAccountCard /> : null
}

/** Deletes, then reports a 401 from a request that was still in flight (same tick). */
function LateUnauthorized() {
  const a = useAuth()
  const qc = useQueryClient()
  return (
    <button
      onClick={async () => {
        if ((await a.deleteAccount('my password 123')) !== null) return
        qc.getQueryCache().notify({ type: 'updated', action: { type: 'error', error: new UnauthenticatedError() }, query: {} } as never)
        qc.getMutationCache().notify({ type: 'updated', action: { type: 'error', error: new UnauthenticatedError() }, mutation: {} } as never)
      }}
    >
      delete-then-401
    </button>
  )
}

async function setup(auth: AuthClient = makeAuth()) {
  const local = new LocalRepo(new AppDb(`del-${crypto.randomUUID()}`))
  await local.init()
  const reset = vi.spyOn(local, 'reset')
  const api = makeApi('acc-1')
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  localStorage.setItem('wt-account-hint', JSON.stringify({ id: 'acc-1', email: 'me@example.test' }))
  render(
    <QueryClientProvider client={qc}>
      <AuthProvider auth={auth} local={local} createApi={() => api as never}>
        <Probe />
        <Gate />
        <LateUnauthorized />
      </AuthProvider>
    </QueryClientProvider>,
  )
  await waitFor(() => expect(screen.getByTestId('s').textContent).toBe('signed-in|api:acc-1'))
  return { auth, local, reset, api, qc }
}

async function openForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Delete account' }))
  return {
    password: screen.getByLabelText('Password'),
    confirm: screen.getByLabelText('Type DELETE to confirm'),
    submit: screen.getByRole('button', { name: 'Delete my account' }),
  }
}

test('explains what is removed and what stays; export lives in "Your data", not here; 44px targets', async () => {
  const user = userEvent.setup()
  await setup()
  expect(screen.getByRole('heading', { name: 'Delete account' })).toBeTruthy()
  expect(screen.getByText(/workout history/i)).toBeTruthy()
  expect(screen.getByText(/Deleted user/)).toBeTruthy()
  expect(screen.getByText(/can.t be undone/i)).toBeTruthy()
  // The one export button of the page sits in the "Your data" card above (data-section.test.tsx).
  expect(screen.queryByRole('button', { name: /export/i })).toBeNull()
  const open = screen.getByRole('button', { name: 'Delete account' })
  expect(open.className).toContain('min-h-11')
  const { submit } = await openForm(user)
  expect(submit.className).toContain('min-h-11')
  expect(screen.getByRole('button', { name: 'Cancel' }).className).toContain('min-h-11')
})

test('the delete button stays disabled until a password is entered and DELETE is typed exactly', async () => {
  const user = userEvent.setup()
  const { auth } = await setup()
  const { password, confirm, submit } = await openForm(user)
  expect((submit as HTMLButtonElement).disabled).toBe(true)
  await user.type(password, 'my password 123')
  expect((submit as HTMLButtonElement).disabled).toBe(true)
  await user.type(confirm, 'delete')
  expect((submit as HTMLButtonElement).disabled).toBe(true)
  await user.clear(confirm)
  await user.type(confirm, 'DELETE')
  expect((submit as HTMLButtonElement).disabled).toBe(false)
  expect(password.getAttribute('autocomplete')).toBe('current-password')
  expect(auth.deleteAccount).not.toHaveBeenCalled()
  // Cancel closes the form without sending anything.
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByLabelText('Password')).toBeNull()
  expect(auth.deleteAccount).not.toHaveBeenCalled()
})

test.each([
  ['invalid_password', /password is incorrect/i],
  ['rate_limited', /too many attempts/i],
  ['offline', /can.t reach the server/i],
])('%s: a clear error, the form keeps its values, nothing on the device changes', async (kind, re) => {
  const user = userEvent.setup()
  const auth = makeAuth({ deleteAccount: vi.fn(async () => { throw new AuthError(kind as never) }) })
  const { reset, api } = await setup(auth)
  const { password, confirm, submit } = await openForm(user)
  await user.type(password, 'wrong password 1')
  await user.type(confirm, 'DELETE')
  await user.click(submit)
  expect((await screen.findByRole('alert')).textContent).toMatch(re)
  expect((password as HTMLInputElement).value).toBe('wrong password 1')
  expect((confirm as HTMLInputElement).value).toBe('DELETE')
  expect(screen.getByTestId('s').textContent).toBe('signed-in|api:acc-1')
  expect(reset).not.toHaveBeenCalled()
  expect(api.clear).not.toHaveBeenCalled()
  expect(localStorage.getItem('wt-account-hint')).not.toBeNull()
})

test('success clears every local trace of the account and returns to an empty guest library', async () => {
  const user = userEvent.setup()
  const success = vi.spyOn(toast, 'success')
  const { auth, local, reset, api, qc } = await setup()
  // Something of the account is cached on the device.
  qc.setQueryData(['plans'], [{ id: 'server-plan' }])
  const { password, confirm, submit } = await openForm(user)
  await user.type(password, 'my password 123')
  await user.type(confirm, 'DELETE')
  await user.click(submit)
  await waitFor(() => expect(screen.getByTestId('s').textContent).toBe('guest|local'))
  expect(auth.deleteAccount).toHaveBeenCalledWith('my password 123')
  expect(api.pause).toHaveBeenCalled() // no queued edit replays against the deleted account
  expect(api.clear).toHaveBeenCalled() // outbox and mirror of this account
  expect(api.dispose).toHaveBeenCalled()
  expect(reset).toHaveBeenCalled()
  expect(qc.getQueryData(['plans'])).toBeUndefined()
  expect(localStorage.getItem('wt-account-hint')).toBeNull()
  expect(await local.listPlans()).toEqual([])
  expect(await local.listSessions()).toEqual([])
  expect(success).toHaveBeenCalledWith(expect.stringMatching(/account (was )?deleted/i))
  // The card is gone in guest mode (as in Settings).
  expect(screen.queryByRole('heading', { name: 'Delete account' })).toBeNull()
})

test('a 401 from a request still in flight after the deletion does not turn the fresh guest into "expired"', async () => {
  const user = userEvent.setup()
  await setup()
  await user.click(screen.getByRole('button', { name: 'delete-then-401' }))
  await waitFor(() => expect(screen.getByTestId('s').textContent).toBe('guest|local'))
  await new Promise((r) => setTimeout(r, 50))
  expect(screen.getByTestId('s').textContent).toBe('guest|local')
})
