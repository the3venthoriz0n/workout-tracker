import { expect, test, vi } from 'vitest'
import { AuthError, createAuthClient } from '../src/auth/client'

function stub(res: Response | Error) {
  return vi.fn<typeof fetch>(async () => {
    if (res instanceof Error) throw res
    return res
  })
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

test('signUp posts JSON with credentials and a name derived from the email', async () => {
  const f = stub(json(200, { user: { id: 'u1', email: 'a@example.com' } }))
  await createAuthClient({ fetch: f }).signUp('a@example.com', 'longenough1')
  const [url, init] = f.mock.calls[0]!
  expect(url).toBe('/api/auth/sign-up/email')
  expect(init?.method).toBe('POST')
  expect(init?.credentials).toBe('include')
  expect(new Headers(init?.headers).get('content-type')).toBe('application/json')
  expect(JSON.parse(init!.body as string)).toEqual({ email: 'a@example.com', password: 'longenough1', name: 'a@example.com' })
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
  const e1 = await createAuthClient({ fetch: stub(json(422, {})) }).signUp('a@example.com', 'longenough1').catch((e: unknown) => e)
  expect((e1 as AuthError).kind).toBe('email_taken')
  const e2 = await createAuthClient({ fetch: stub(new TypeError('x')) }).signIn('a@example.com', 'longenough1').catch((e: unknown) => e)
  expect((e2 as AuthError).kind).toBe('offline')
})

test('sign-up 403 means sign-ups are closed; sign-in 403 stays a server error', async () => {
  const body = { code: 'SIGNUP_CLOSED', message: 'signup_closed' }
  const e1 = await createAuthClient({ fetch: stub(json(403, body)) }).signUp('a@example.com', 'longenough1').catch((e: unknown) => e)
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
