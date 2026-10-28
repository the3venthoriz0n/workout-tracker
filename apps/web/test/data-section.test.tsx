// Settings > data (spec §3, §8): one "Export my data" on the page, signed in or not, and "Restore
// from a file", which REPLACES everything after a summary and a typed confirmation.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApiError, ImportInvalidError, OfflineError, type ExportData } from '@workout/shared'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { toast } from 'sonner'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { routes } from '../src/app/router'
import type { AuthClient } from '../src/auth/client'
import { AuthProvider, useAuth } from '../src/auth/auth-provider'
import type { AuthState } from '../src/auth/context'
import { AppDb } from '../src/repo/db'
import { LocalRepo } from '../src/repo/local-repo'

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

function makeAuth(signedIn: boolean): AuthClient {
  return {
    signUp: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(async () => {}),
    resendSetupLink: vi.fn(),
    requestPasswordReset: vi.fn(),
    resetPassword: vi.fn(),
    deleteAccount: vi.fn(),
    session: async () => (signedIn ? { userId: 'acc-1', email: 'me@example.test' } : null),
  }
}

/** A signed-in API stub: the account's profile, an export, a restore and the outbox controls. */
function makeApi(file: ExportData) {
  // Like the real outbox: pause() and resume() tell the subscriber (the provider treats a pause on a
  // signed-in account as "the session ended", which a restore's own pause must not be).
  let listener: ((s: { pending: number; paused: boolean; version: number }) => void) | undefined
  const controls = {
    getProfile: vi.fn(async () => ({ ...file.profile, user_id: 'acc-1' })),
    exportAll: vi.fn(async () => file),
    replaceAll: vi.fn(async (_password: string, _data: ExportData) => {}),
    importAll: vi.fn(async () => {}),
    ready: Promise.resolve(),
    pending: () => 0,
    paused: () => false,
    flush: vi.fn(async () => {}),
    resume: vi.fn(() => listener?.({ pending: 0, paused: false, version: 0 })),
    pause: vi.fn(() => listener?.({ pending: 0, paused: true, version: 0 })),
    idle: vi.fn(async () => {}),
    clear: vi.fn(async () => {}),
    dispose: vi.fn(),
    hasOfflineData: vi.fn(async () => false),
    subscribe: (cb: (s: { pending: number; paused: boolean; version: number }) => void) => {
      listener = cb
      return () => {
        listener = undefined
      }
    },
  }
  // Every other Repo read answers empty.
  return new Proxy(controls, {
    get: (t, k: string) => (k in t ? t[k as keyof typeof t] : k === 'then' ? undefined : vi.fn(async () => [])),
  }) as typeof controls
}

/** A real export with one plan, one finished workout and kg, from another device. */
async function exportFile(): Promise<ExportData> {
  const src = new LocalRepo(new AppDb(`src-${crypto.randomUUID()}`))
  await src.init()
  await src.updateProfile({ units: 'kg' })
  const plan = await src.savePlan({ name: 'Restored plan' })
  const day = await src.savePlanDay({ plan_id: plan.id, name: 'Day 1' })
  const bench = (await src.listExercises()).find((e) => e.name === 'Bench Press')!
  await src.addPlanItem(day.id, bench.id)
  const s = await src.startSession(day.id)
  await src.finishSession(s.id)
  return src.exportAll()
}

const fileOf = (content: string, name = 'backup.json') => new File([content], name, { type: 'application/json' })

async function renderSettings(signedIn: boolean, file?: ExportData) {
  const local = new LocalRepo(new AppDb(`data-${crypto.randomUUID()}`))
  await local.init()
  const api = makeApi(file ?? (await exportFile()))
  if (signedIn) localStorage.setItem('wt-account-hint', JSON.stringify({ id: 'acc-1', email: 'me@example.test' }))
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter(routes, { initialEntries: ['/settings'] })
  render(
    <QueryClientProvider client={qc}>
      <AuthProvider auth={makeAuth(signedIn)} local={local} createApi={() => api as never}>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  )
  await screen.findByRole('button', { name: 'Restore from a file' })
  return { local, api, qc }
}

const exportButtons = () => screen.getAllByRole('button').filter((b) => /export/i.test(b.textContent ?? ''))

describe('layout', () => {
  test('guest: one Data card with one export button and the restore button; no delete', async () => {
    await renderSettings(false)
    expect(screen.getByRole('heading', { name: 'Data' })).toBeTruthy()
    expect(exportButtons()).toHaveLength(1)
    expect(exportButtons()[0]!.textContent).toBe('Export my data')
    expect(screen.queryByRole('heading', { name: 'Delete account' })).toBeNull()
    for (const name of ['Export my data', 'Restore from a file']) {
      expect(screen.getByRole('button', { name }).className).toContain('min-h-11')
    }
  })

  test('signed in: exactly one export button, in "Your data" right above Delete account', async () => {
    await renderSettings(true)
    await screen.findByRole('heading', { name: 'Delete account' })
    expect(exportButtons()).toHaveLength(1)
    expect(screen.queryByRole('heading', { name: 'Data' })).toBeNull()
    const yours = screen.getByRole('heading', { name: 'Your data' })
    const del = screen.getByRole('heading', { name: 'Delete account' })
    expect(yours.compareDocumentPosition(del) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Nothing sits between them: the next card after "Your data" is the delete card.
    const yourCard = yours.closest('[data-slot="card"]')!
    expect(yourCard.nextElementSibling?.contains(del)).toBe(true)
    expect(within(yourCard as HTMLElement).getByRole('button', { name: 'Export my data' })).toBeTruthy()
    expect(within(yourCard as HTMLElement).getByRole('button', { name: 'Restore from a file' })).toBeTruthy()
  })
})

describe('restore as a guest (this device)', () => {
  test('shows a summary first and changes nothing until REPLACE is typed and confirmed', async () => {
    const user = userEvent.setup()
    const file = await exportFile()
    const { local } = await renderSettings(false)
    const before = await local.exportAll()
    const importAll = vi.spyOn(local, 'importAll')
    await user.upload(screen.getByLabelText('Restore file'), fileOf(JSON.stringify(file)))

    const summary = await screen.findByRole('region', { name: 'Restore summary' })
    expect(summary.textContent).toMatch(/1 plan\b/)
    expect(summary.textContent).toMatch(/16 exercises/)
    expect(summary.textContent).toMatch(/1 workout\b/)
    expect(summary.textContent).toMatch(/kg/)
    expect(screen.getByText(/replaces everything in your library and history on this device/i)).toBeTruthy()
    // No password for a guest (the sign-in form elsewhere on the page has its own).
    expect(within(screen.getByRole('alertdialog', { name: 'Confirm restore' })).queryByLabelText('Password')).toBeNull()
    expect(importAll).not.toHaveBeenCalled()

    const submit = screen.getByRole('button', { name: 'Replace my data' }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    await user.type(screen.getByLabelText('Type REPLACE to confirm'), 'replace')
    expect(submit.disabled).toBe(true)
    expect((await local.exportAll()).plans).toEqual(before.plans)

    await user.clear(screen.getByLabelText('Type REPLACE to confirm'))
    await user.type(screen.getByLabelText('Type REPLACE to confirm'), 'REPLACE')
    const ok = vi.spyOn(toast, 'success')
    await user.click(submit)
    await waitFor(async () => expect((await local.listPlans()).map((p) => p.name)).toEqual(['Restored plan']))
    expect((await local.getProfile()).units).toBe('kg')
    expect(ok).toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Restore summary' })).toBeNull())
  })

  test('"Export current data first" downloads the current data before anything changes', async () => {
    const user = userEvent.setup()
    const file = await exportFile()
    const { local } = await renderSettings(false)
    const spy = vi.spyOn(local, 'exportAll')
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await user.upload(screen.getByLabelText('Restore file'), fileOf(JSON.stringify(file)))
    const btn = await screen.findByRole('button', { name: 'Export current data first' })
    expect(btn.className).toContain('min-h-11')
    await user.click(btn)
    await waitFor(() => expect(spy).toHaveBeenCalled())
  })

  test.each([
    ['not JSON', 'this is not json'],
    ['JSON but not an export', JSON.stringify({ hello: 'world' })],
  ])('an invalid file (%s) is refused clearly and nothing changes', async (_what, content) => {
    const user = userEvent.setup()
    const { local } = await renderSettings(false)
    const importAll = vi.spyOn(local, 'importAll')
    await user.upload(screen.getByLabelText('Restore file'), fileOf(content))
    expect((await screen.findByRole('alert')).textContent).toMatch(/isn.t a valid export.*nothing was changed/i)
    expect(screen.queryByRole('region', { name: 'Restore summary' })).toBeNull()
    expect(importAll).not.toHaveBeenCalled()
  })

  test('a dangling reference is caught before the summary (the shared validation)', async () => {
    const user = userEvent.setup()
    const file = await exportFile()
    file.plan_days[0]!.plan_id = crypto.randomUUID()
    const { local } = await renderSettings(false)
    const importAll = vi.spyOn(local, 'importAll')
    await user.upload(screen.getByLabelText('Restore file'), fileOf(JSON.stringify(file)))
    expect((await screen.findByRole('alert')).textContent).toMatch(/isn.t a valid export/i)
    expect(importAll).not.toHaveBeenCalled()
  })

  test('a file over 10 MB is refused without reading it', async () => {
    const user = userEvent.setup()
    await renderSettings(false)
    const big = fileOf('{}')
    Object.defineProperty(big, 'size', { value: 10 * 1024 * 1024 + 1 })
    const text = vi.spyOn(big, 'text')
    await user.upload(screen.getByLabelText('Restore file'), big)
    // The same wording as the server's 413.
    expect((await screen.findByRole('alert')).textContent).toMatch(/too big.*10 MB.*nothing was changed/i)
    expect(text).not.toHaveBeenCalled()
  })

  test('cancel closes the confirmation without changing anything', async () => {
    const user = userEvent.setup()
    const file = await exportFile()
    const { local } = await renderSettings(false)
    const importAll = vi.spyOn(local, 'importAll')
    await user.upload(screen.getByLabelText('Restore file'), fileOf(JSON.stringify(file)))
    await screen.findByRole('region', { name: 'Restore summary' })
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('region', { name: 'Restore summary' })).toBeNull()
    expect(importAll).not.toHaveBeenCalled()
  })
})

describe('restore while signed in (this account)', () => {
  async function fillForm(user: ReturnType<typeof userEvent.setup>, file: ExportData, password = 'my password 123') {
    await user.upload(screen.getByLabelText('Restore file'), fileOf(JSON.stringify(file)))
    await screen.findByRole('region', { name: 'Restore summary' })
    expect(screen.getByText(/replaces everything in your library and history on this account/i)).toBeTruthy()
    const submit = screen.getByRole('button', { name: 'Replace my data' }) as HTMLButtonElement
    await user.type(screen.getByLabelText('Type REPLACE to confirm'), 'REPLACE')
    expect(submit.disabled).toBe(true) // the password is required too
    await user.type(screen.getByLabelText('Password'), password)
    expect(submit.disabled).toBe(false)
    expect(screen.getByLabelText('Password').getAttribute('autocomplete')).toBe('current-password')
    return submit
  }

  test('success: sends password and file, pauses then clears the outbox, refreshes and says so', async () => {
    const user = userEvent.setup()
    const file = await exportFile()
    const { api, qc } = await renderSettings(true, file)
    await screen.findByRole('heading', { name: 'Delete account' })
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    const ok = vi.spyOn(toast, 'success')
    await user.click(await fillForm(user, file))
    await waitFor(() => expect(api.replaceAll).toHaveBeenCalledTimes(1))
    expect(api.replaceAll.mock.calls[0]![0]).toBe('my password 123')
    expect(api.replaceAll.mock.calls[0]![1].plans.map((p) => p.name)).toEqual(['Restored plan'])
    expect(api.importAll).not.toHaveBeenCalled()
    expect(api.pause.mock.invocationCallOrder[0]!).toBeLessThan(api.idle.mock.invocationCallOrder[0]!)
    expect(api.idle.mock.invocationCallOrder[0]!).toBeLessThan(api.replaceAll.mock.invocationCallOrder[0]!)
    await waitFor(() => expect(api.clear).toHaveBeenCalled())
    await waitFor(() => expect(invalidate).toHaveBeenCalled())
    expect(ok).toHaveBeenCalled()
    // The restore's own pause of the outbox is not an expired session: still signed in afterwards.
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByText(/signed out/i)).toBeNull()
    expect(screen.getByRole('heading', { name: 'Delete account' })).toBeTruthy()
  })

  test.each([
    ['wrong password', new ApiError(403, 'invalid_password'), /password is incorrect/i],
    ['a published plan', new ApiError(409, 'has_published'), /unpublish/i],
    ['rate limited', new ApiError(429, 'rate_limited'), /too many attempts/i],
    ['offline', new OfflineError(), /can.t reach the server/i],
    ['invalid on the server', new ImportInvalidError(), /isn.t a valid export/i],
  ])('%s: a clear message, the form keeps its values, the outbox carries on', async (_what, err, re) => {
    const user = userEvent.setup()
    const file = await exportFile()
    const { api } = await renderSettings(true, file)
    await screen.findByRole('heading', { name: 'Delete account' })
    api.replaceAll.mockRejectedValueOnce(err)
    await user.click(await fillForm(user, file))
    expect((await screen.findByRole('alert')).textContent).toMatch(re)
    expect((await screen.findByRole('alert')).textContent).toMatch(/nothing was changed/i)
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('my password 123')
    expect((screen.getByLabelText('Type REPLACE to confirm') as HTMLInputElement).value).toBe('REPLACE')
    expect(api.resume).toHaveBeenCalled()
    expect(api.clear).not.toHaveBeenCalled()
  })
})

describe('restore guards', () => {
  test('a replay already in flight finishes before the restore request is sent', async () => {
    const user = userEvent.setup()
    const file = await exportFile()
    const { api } = await renderSettings(true, file)
    await screen.findByRole('heading', { name: 'Delete account' })
    let release!: () => void
    api.idle.mockImplementationOnce(() => new Promise<void>((r) => (release = r)))
    await user.upload(screen.getByLabelText('Restore file'), fileOf(JSON.stringify(file)))
    await user.type(await screen.findByLabelText('Type REPLACE to confirm'), 'REPLACE')
    await user.type(screen.getByLabelText('Password'), 'my password 123')
    await user.click(screen.getByRole('button', { name: 'Replace my data' }))
    await waitFor(() => expect(api.idle).toHaveBeenCalled())
    expect(api.pause).toHaveBeenCalled()
    await new Promise((r) => setTimeout(r, 20))
    expect(api.replaceAll).not.toHaveBeenCalled()
    release()
    await waitFor(() => expect(api.replaceAll).toHaveBeenCalledTimes(1))
  })

  test('a second submit while the first runs is ignored: one request, no error', async () => {
    const user = userEvent.setup()
    const file = await exportFile()
    const { api } = await renderSettings(true, file)
    await screen.findByRole('heading', { name: 'Delete account' })
    let release!: () => void
    api.replaceAll.mockImplementationOnce(() => new Promise<void>((r) => (release = r)))
    await user.upload(screen.getByLabelText('Restore file'), fileOf(JSON.stringify(file)))
    await user.type(await screen.findByLabelText('Type REPLACE to confirm'), 'REPLACE')
    await user.type(screen.getByLabelText('Password'), 'my password 123')
    const form = screen.getByRole('alertdialog', { name: 'Confirm restore' }) as HTMLFormElement
    form.requestSubmit()
    form.requestSubmit()
    await waitFor(() => expect(api.replaceAll).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('alert')).toBeNull()
    release()
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Restore summary' })).toBeNull())
    expect(api.replaceAll).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  test.each([
    ['guest state, form says signed in', false, true],
    ['signed-in state, form says guest', true, false],
  ])('%s: refused with "server" and nothing is written', async (_what, live, claimed) => {
    const file = await exportFile()
    let auth!: AuthState
    function Grab() {
      auth = useAuth()
      return null
    }
    const local = new LocalRepo(new AppDb(`guard-${crypto.randomUUID()}`))
    await local.init()
    const importAll = vi.spyOn(local, 'importAll')
    const api = makeApi(file)
    if (live) localStorage.setItem('wt-account-hint', JSON.stringify({ id: 'acc-1', email: 'me@example.test' }))
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider auth={makeAuth(live)} local={local} createApi={() => api as never}>
          <Grab />
        </AuthProvider>
      </QueryClientProvider>,
    )
    await waitFor(() => expect(auth.status).toBe(live ? 'signed-in' : 'guest'))
    expect(await auth.restoreData(file, { signedIn: claimed, password: 'my password 123' })).toBe('server')
    expect(importAll).not.toHaveBeenCalled()
    expect(api.replaceAll).not.toHaveBeenCalled()
  })
})
