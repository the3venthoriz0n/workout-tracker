import { expect, test, vi } from 'vitest'
import { AuthError, createAuthClient, generateSignupPassword } from '../src/auth/client'

function stub(res: Response | Error) {
  return vi.fn<typeof fetch>(async () => {
    if (res instanceof Error) throw res
    return res
  })
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

test('signUp takes the email only and sends a random throwaway password the user never sees', async () => {
  const f = stub(json(200, { user: { id: 'u1', email: 'a@example.com' } }))
  const c = createAuthClient({ fetch: f })
  await c.signUp('a@example.com')
  await c.signUp('a@example.com')
  const [url, init] = f.mock.calls[0]!
  expect(url).toBe('/api/auth/sign-up/email')
  expect(init?.method).toBe('POST')
  expect(init?.credentials).toBe('include')
  expect(new Headers(init?.headers).get('content-type')).toBe('application/json')
  const bodies = f.mock.calls.map((c) => JSON.parse(c[1]!.body as string) as { email: string; password: string; name: string })
  expect(bodies[0]).toMatchObject({ email: 'a@example.com', name: 'a@example.com' })
  expect(Object.keys(bodies[0]!).sort()).toEqual(['email', 'name', 'password'])
  // 32 random bytes, base64url: 43 characters, within the server's 10-128 limit, new every call.
  for (const b of bodies) expect(b.password).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(bodies[0]!.password).not.toBe(bodies[1]!.password)
})

test('the throwaway password comes from crypto.getRandomValues with at least 32 bytes', () => {
  const spy = vi.spyOn(globalThis.crypto, 'getRandomValues')
  const a = generateSignupPassword()
  const b = generateSignupPassword()
  expect(spy).toHaveBeenCalledTimes(2)
  expect((spy.mock.calls[0]![0] as Uint8Array).byteLength).toBeGreaterThanOrEqual(32)
  expect(a).toMatch(/^[A-Za-z0-9_-]{43,}$/)
  expect(a).not.toBe(b)
  spy.mockRestore()
})

test('signIn and signOut always send a JSON body', async () => {
  const f = stub(json(200, {}))
  const c = createAuthClient({ fetch: f })
  await c.signIn('a@example.com', 'longenough1')
  await c.signOut()
  expect(f.mock.calls[0]![0]).toBe('/api/auth/sign-in/email')
  expect(f.mock.calls[1]![0]).toBe('/api/auth/sign-out')
  expect(f.mock.calls[1]![1]?.body).toBe('{}')
  expect(new Headers(f.mock.calls[1]![1]?.headers).get('content-type')).toBe('application/json')
})

test.each([
  [401, 'invalid_credentials'],
  [429, 'rate_limited'],
  [500, 'server'],
])('sign-in %i maps to %s without echoing the body', async (status, kind) => {
  const c = createAuthClient({ fetch: stub(json(status, { message: 'SECRET-DETAIL' })) })
  const err = await c.signIn('a@example.com', 'longenough1').catch((e: unknown) => e)
  expect(err).toBeInstanceOf(AuthError)
  expect((err as AuthError).kind).toBe(kind)
  expect(String((err as AuthError).message)).not.toContain('SECRET')
})

test('sign-up 422 means the email is unusable; network failure means offline', async () => {
  const e1 = await createAuthClient({ fetch: stub(json(422, {})) }).signUp('a@example.com').catch((e: unknown) => e)
  expect((e1 as AuthError).kind).toBe('email_taken')
  const e2 = await createAuthClient({ fetch: stub(new TypeError('x')) }).signIn('a@example.com', 'longenough1').catch((e: unknown) => e)
  expect((e2 as AuthError).kind).toBe('offline')
})

test('sign-up 403 means sign-ups are closed; sign-in 403 stays a server error', async () => {
  const body = { code: 'SIGNUP_CLOSED', message: 'signup_closed' }
  const e1 = await createAuthClient({ fetch: stub(json(403, body)) }).signUp('a@example.com').catch((e: unknown) => e)
  expect((e1 as AuthError).kind).toBe('signup_closed')
  const e2 = await createAuthClient({ fetch: stub(json(403, body)) }).signIn('a@example.com', 'longenough1').catch((e: unknown) => e)
  expect((e2 as AuthError).kind).toBe('server')
})

test('session returns user or null, and throws offline/server', async () => {
  expect(await createAuthClient({ fetch: stub(json(200, null)) }).session()).toBeNull()
  expect(await createAuthClient({ fetch: stub(json(401, {})) }).session()).toBeNull()
  expect(
    await createAuthClient({ fetch: stub(json(200, { session: {}, user: { id: 'u1', email: 'a@example.com' } })) }).session(),
  ).toEqual({ userId: 'u1', email: 'a@example.com' })
  const off = await createAuthClient({ fetch: stub(new TypeError('x')) }).session().catch((e: unknown) => e)
  expect((off as AuthError).kind).toBe('offline')
  const srv = await createAuthClient({ fetch: stub(json(503, {})) }).session().catch((e: unknown) => e)
  expect((srv as AuthError).kind).toBe('server')
})

test('sign-in 403 EMAIL_NOT_VERIFIED maps to email_not_verified', async () => {
  const body = { code: 'EMAIL_NOT_VERIFIED', message: 'SECRET-DETAIL' }
  const err = await createAuthClient({ fetch: stub(json(403, body)) }).signIn('a@example.com', 'longenough1').catch((e: unknown) => e)
  expect((err as AuthError).kind).toBe('email_not_verified')
  expect(String((err as AuthError).message)).not.toContain('SECRET')
})

test('resendSetupLink, requestPasswordReset and resetPassword post JSON bodies', async () => {
  const f = stub(json(200, { status: true }))
  const c = createAuthClient({ fetch: f })
  await c.resendSetupLink('a@example.com')
  await c.requestPasswordReset('a@example.com')
  await c.resetPassword('tok', 'newlongpass1')
  expect(f.mock.calls.map((x) => x[0])).toEqual([
    '/api/auth/request-password-reset',
    '/api/auth/request-password-reset',
    '/api/auth/reset-password',
  ])
  expect(JSON.parse(f.mock.calls[0]![1]!.body as string)).toEqual({ email: 'a@example.com' })
  expect(JSON.parse(f.mock.calls[1]![1]!.body as string)).toEqual({ email: 'a@example.com' })
  expect(JSON.parse(f.mock.calls[2]![1]!.body as string)).toEqual({ token: 'tok', newPassword: 'newlongpass1' })
  for (const [, init] of f.mock.calls) {
    expect(init?.method).toBe('POST')
    expect(init?.credentials).toBe('include')
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json')
  }
})

test.each([
  [429, {}, 'rate_limited'],
  [400, { code: 'INVALID_TOKEN', message: 'SECRET' }, 'invalid_token'],
  [400, { code: 'PASSWORD_TOO_SHORT' }, 'invalid_input'],
  [500, {}, 'server'],
])('resetPassword %i maps to %s', async (status, body, kind) => {
  const err = await createAuthClient({ fetch: stub(json(status, body)) }).resetPassword('t', 'newlongpass1').catch((e: unknown) => e)
  expect((err as AuthError).kind).toBe(kind)
  expect(String((err as AuthError).message)).not.toContain('SECRET')
})

test('email requests map 429 and network failure', async () => {
  const e1 = await createAuthClient({ fetch: stub(json(429, {})) }).requestPasswordReset('a@example.com').catch((e: unknown) => e)
  expect((e1 as AuthError).kind).toBe('rate_limited')
  const e2 = await createAuthClient({ fetch: stub(new TypeError('x')) }).resendSetupLink('a@example.com').catch((e: unknown) => e)
  expect((e2 as AuthError).kind).toBe('offline')
})

test('deleteAccount sends DELETE /api/v1/account with the password as JSON and credentials', async () => {
  const f = stub(new Response(null, { status: 204 }))
  await createAuthClient({ fetch: f, baseUrl: 'https://app.example.invalid/' }).deleteAccount('my password 123')
  const [url, init] = f.mock.calls[0]!
  expect(url).toBe('https://app.example.invalid/api/v1/account')
  expect(init?.method).toBe('DELETE')
  expect(init?.credentials).toBe('include')
  expect(new Headers(init?.headers).get('content-type')).toBe('application/json')
  expect(JSON.parse(init!.body as string)).toEqual({ password: 'my password 123' })
})

test.each([
  [403, { error: 'invalid_password' }, 'invalid_password'],
  [429, { error: 'rate_limited' }, 'rate_limited'],
  [401, { error: 'unauthorized' }, 'session_expired'],
  [400, { error: 'invalid' }, 'invalid_password'],
  [500, { error: 'internal_error', message: 'SECRET-DETAIL' }, 'server'],
])('deleteAccount %i maps to its kind without echoing the body', async (status, body, kind) => {
  const err = await createAuthClient({ fetch: stub(json(status, body)) }).deleteAccount('pw').catch((e: unknown) => e)
  expect(err).toBeInstanceOf(AuthError)
  expect((err as AuthError).kind).toBe(kind)
  expect(String((err as AuthError).message)).not.toContain('SECRET')
})

test('deleteAccount without a connection is offline', async () => {
  const err = await createAuthClient({ fetch: stub(new TypeError('net')) }).deleteAccount('pw').catch((e: unknown) => e)
  expect((err as AuthError).kind).toBe('offline')
})
