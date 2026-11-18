import { AlreadyHasDataError, ProfileNotFoundError } from '@workout/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthError } from '../src/auth/client'
import { consumeGoogleReturn, startGoogleSignIn } from '../src/auth/google'
import { googleReturnFlow } from '../src/auth/import-flow'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

describe('startGoogleSignIn', () => {
  beforeEach(() => sessionStorage.clear())

  it('goes to the URL the server returns and remembers the return', async () => {
    const go = vi.fn()
    const fetch = vi.fn().mockResolvedValue(json({ url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1', redirect: true }))
    await startGoogleSignIn({ fetch, go })
    expect(go).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth?x=1')
    expect(JSON.parse(fetch.mock.calls[0]![1].body)).toMatchObject({ provider: 'google', callbackURL: '/settings' })
    expect(consumeGoogleReturn()).toBe(true)
    expect(consumeGoogleReturn()).toBe(false) // once per return
  })

  it('does not leave the page, or leave a marker, when the server refuses', async () => {
    const go = vi.fn()
    await expect(startGoogleSignIn({ fetch: vi.fn().mockResolvedValue(json({}, 404)), go })).rejects.toMatchObject({ kind: 'server' })
    await expect(startGoogleSignIn({ fetch: vi.fn().mockResolvedValue(json({}, 429)), go })).rejects.toMatchObject({ kind: 'rate_limited' })
    await expect(startGoogleSignIn({ fetch: vi.fn().mockRejectedValue(new TypeError('x')), go })).rejects.toBeInstanceOf(AuthError)
    expect(go).not.toHaveBeenCalled()
    expect(consumeGoogleReturn()).toBe(false)
  })
})

describe('googleReturnFlow', () => {
  const deps = (getProfile: () => Promise<unknown>, importAll = vi.fn().mockResolvedValue(undefined)) => {
    const local = { exportAll: vi.fn().mockResolvedValue({}), reset: vi.fn().mockResolvedValue(undefined) }
    const auth = { signOut: vi.fn().mockResolvedValue(undefined) }
    return { d: { auth, local, api: { getProfile, importAll } } as never, local, auth, importAll }
  }

  it('uploads guest data to a new account', async () => {
    const x = deps(() => Promise.reject(new ProfileNotFoundError()))
    expect(await googleReturnFlow(x.d)).toBe('signed-in')
    expect(x.importAll).toHaveBeenCalled()
    expect(x.local.reset).toHaveBeenCalled()
  })

  it('asks before discarding guest data when the account already has data', async () => {
    const x = deps(() => Promise.resolve({}))
    expect(await googleReturnFlow(x.d)).toBe('confirm-discard')
    expect(x.local.reset).not.toHaveBeenCalled()
  })

  it('fails closed when the account cannot be checked', async () => {
    const x = deps(() => Promise.reject(new Error('down')))
    await expect(googleReturnFlow(x.d)).rejects.toMatchObject({ kind: 'check_failed' })
    expect(x.auth.signOut).toHaveBeenCalled()
    expect(x.local.reset).not.toHaveBeenCalled()
  })

  it('keeps guest data on an upload that finds data', async () => {
    const x = deps(() => Promise.reject(new ProfileNotFoundError()), vi.fn().mockRejectedValue(new AlreadyHasDataError()))
    expect(await googleReturnFlow(x.d)).toBe('confirm-discard')
    expect(x.local.reset).not.toHaveBeenCalled()
  })
})
