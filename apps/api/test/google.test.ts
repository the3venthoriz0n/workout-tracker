import { afterEach, describe, expect, it } from 'vitest'
import { setupApp, type Harness } from './helpers.js'

let h: Harness
afterEach(async () => {
  await h?.cleanup()
})

const GOOGLE = { GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'test-secret' }

async function startGoogle() {
  return h.request('/api/auth/sign-in/social', {
    method: 'POST',
    body: { provider: 'google', callbackURL: '/settings', errorCallbackURL: '/settings' },
  })
}

describe('Google sign-in', () => {
  it('is off unless both halves of the OAuth client are set', async () => {
    h = await setupApp()
    const config = await h.request('/api/auth-config')
    expect(await config.json()).toEqual({ google: false })
    expect(config.headers.get('cache-control')).toBe('no-store')
    expect((await startGoogle()).ok).toBe(false)

    await h.cleanup()
    h = await setupApp({ GOOGLE_CLIENT_ID: GOOGLE.GOOGLE_CLIENT_ID })
    expect(await (await h.request('/api/auth-config')).json()).toEqual({ google: false })
  })

  it('sends the browser to Google with the app callback when configured', async () => {
    h = await setupApp(GOOGLE)
    expect(await (await h.request('/api/auth-config')).json()).toEqual({ google: true })
    const res = await startGoogle()
    expect(res.status).toBe(200)
    const { url } = (await res.json()) as { url: string }
    const u = new URL(url)
    expect(u.origin).toBe('https://accounts.google.com')
    expect(u.searchParams.get('client_id')).toBe(GOOGLE.GOOGLE_CLIENT_ID)
    expect(u.searchParams.get('redirect_uri')).toBe('http://localhost:3000/api/auth/callback/google')
    expect(u.searchParams.get('state')).toBeTruthy()
    // PKCE, so an intercepted code is useless
    expect(u.searchParams.get('code_challenge')).toBeTruthy()
  })

  it('never exposes the client secret', async () => {
    h = await setupApp(GOOGLE)
    const body = await (await h.request('/api/auth-config')).text()
    expect(body).not.toContain(GOOGLE.GOOGLE_CLIENT_SECRET)
    const start = await (await startGoogle()).text()
    expect(start).not.toContain(GOOGLE.GOOGLE_CLIENT_SECRET)
  })
})
