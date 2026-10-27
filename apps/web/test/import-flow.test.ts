import { AlreadyHasDataError, OfflineError, ProfileNotFoundError, type ExportData } from '@workout/shared'
import { expect, test, vi } from 'vitest'
import { AuthError, type SessionUser } from '../src/auth/client'
import { cancelDiscard, confirmDiscard, retryUpload, signInFlow, signOutFlow, signUpFlow } from '../src/auth/import-flow'

const DATA = { version: 1, gear: [] } as unknown as ExportData

function deps(over: { getProfile?: () => Promise<unknown>; importAll?: () => Promise<void>; signIn?: () => Promise<SessionUser>; signOut?: () => Promise<void>; signUp?: () => Promise<SessionUser> } = {}) {
  const calls: string[] = []
  const log = <T>(name: string, fn: () => Promise<T>) => async () => {
    calls.push(name)
    return fn()
  }
  return {
    calls,
    auth: {
      signUp: vi.fn(log('signUp', over.signUp ?? (async () => ({ userId: 'u', email: 'a@example.com' })))),
      signIn: vi.fn(log('signIn', over.signIn ?? (async () => ({ userId: 'u', email: 'a@example.com' })))),
      signOut: vi.fn(log('signOut', over.signOut ?? (async () => {}))),
      session: vi.fn(async () => null),
      resendVerification: vi.fn(async () => {}),
      requestPasswordReset: vi.fn(async () => {}),
      resetPassword: vi.fn(async () => {}),
      deleteAccount: vi.fn(async () => {}),
    },
    local: { exportAll: vi.fn(log('export', async () => DATA)), reset: vi.fn(log('reset', async () => {})) },
    api: {
      getProfile: vi.fn(log('getProfile', over.getProfile ?? (async () => { throw new ProfileNotFoundError() }))),
      importAll: vi.fn(log('import', over.importAll ?? (async () => {}))),
    },
  }
}

test('sign-up ends in verify-email and neither uploads nor clears guest data', async () => {
  const d = deps()
  expect(await signUpFlow(d, 'a@example.com', 'longenough1')).toBe('verify-email')
  expect(d.calls).toEqual(['signUp'])
  expect(d.api.importAll).not.toHaveBeenCalled()
  expect(d.api.getProfile).not.toHaveBeenCalled()
  expect(d.local.exportAll).not.toHaveBeenCalled()
  expect(d.local.reset).not.toHaveBeenCalled()
})

test('first sign-in of a verified new account uploads the guest data; upload failure keeps it and retry succeeds', async () => {
  let fail = true
  const d = deps({ importAll: async () => { if (fail) throw new OfflineError() } })
  expect(await signInFlow(d, 'a@example.com', 'longenough1')).toBe('upload-failed')
  expect(d.calls).toEqual(['signIn', 'getProfile', 'export', 'import'])
  expect(d.local.reset).not.toHaveBeenCalled()
  fail = false
  expect(await retryUpload(d)).toBe('signed-in')
  expect(d.local.reset).toHaveBeenCalledTimes(1)
})

test('sign-in of an unverified account throws and touches nothing', async () => {
  const d = deps({ signIn: async () => { throw new AuthError('email_not_verified') } })
  await expect(signInFlow(d, 'a@example.com', 'longenough1')).rejects.toMatchObject({ kind: 'email_not_verified' })
  expect(d.calls).toEqual(['signIn'])
  expect(d.local.reset).not.toHaveBeenCalled()
})

test('sign-up account creation failure throws and touches nothing', async () => {
  const d = deps({ signUp: async () => { throw new AuthError('email_taken') } })
  await expect(signUpFlow(d, 'a@example.com', 'longenough1')).rejects.toBeInstanceOf(AuthError)
  expect(d.local.exportAll).not.toHaveBeenCalled()
  expect(d.local.reset).not.toHaveBeenCalled()
})

test('sign-in to an empty new account imports the guest data like sign-up', async () => {
  const d = deps()
  expect(await signInFlow(d, 'a@example.com', 'longenough1')).toBe('signed-in')
  expect(d.calls).toEqual(['signIn', 'getProfile', 'export', 'import', 'reset'])
})

test('sign-in to an account with data asks for confirmation and discards nothing yet', async () => {
  const d = deps({ getProfile: async () => ({ user_id: 'u' }) })
  expect(await signInFlow(d, 'a@example.com', 'longenough1')).toBe('confirm-discard')
  expect(d.local.reset).not.toHaveBeenCalled()
  expect(d.api.importAll).not.toHaveBeenCalled()
})

test('confirming discards guest data; cancelling signs out and keeps it', async () => {
  const d = deps({ getProfile: async () => ({ user_id: 'u' }) })
  await confirmDiscard(d)
  expect(d.local.reset).toHaveBeenCalledTimes(1)
  const c = deps()
  await cancelDiscard(c)
  expect(c.auth.signOut).toHaveBeenCalled()
  expect(c.local.reset).not.toHaveBeenCalled()
})

test('fail closed: if the data-exists check fails nothing is discarded or uploaded', async () => {
  const d = deps({ getProfile: async () => { throw new OfflineError() } })
  await expect(signInFlow(d, 'a@example.com', 'longenough1')).rejects.toMatchObject({ kind: 'check_failed' })
  expect(d.local.reset).not.toHaveBeenCalled()
  expect(d.api.importAll).not.toHaveBeenCalled()
  expect(d.auth.signOut).toHaveBeenCalled()
})

test('retry that hits 409 already_has_data goes to the confirm path, not a discard', async () => {
  const d = deps({ importAll: async () => { throw new AlreadyHasDataError() } })
  expect(await retryUpload(d)).toBe('confirm-discard')
  expect(d.local.reset).not.toHaveBeenCalled()
})

test('sign-out resets to a fresh guest DB only after the server sign-out; failure keeps state', async () => {
  const d = deps()
  await signOutFlow(d)
  expect(d.calls).toEqual(['signOut', 'reset'])
  const bad = deps({ signOut: async () => { throw new AuthError('offline') } })
  await expect(signOutFlow(bad)).rejects.toBeInstanceOf(AuthError)
  expect(bad.local.reset).not.toHaveBeenCalled()
})
