import { afterEach, describe, expect, it, vi } from 'vitest'
import { openKey, sealKey } from '../src/ai/key-crypto.js'
import { assertPublicUrl, isPrivateAddress } from '../src/ai/safe-fetch.js'
import { signUpClient, type Client } from './fixture.js'
import { setupApp, type Harness } from './helpers.js'

describe('sealed keys', () => {
  it('round-trips, differs each time, and fails closed under another secret or when altered', () => {
    const a = sealKey('secret-one', 'sk-abc12345')
    expect(a).not.toContain('sk-abc12345')
    expect(sealKey('secret-one', 'sk-abc12345')).not.toBe(a)
    expect(openKey('secret-one', a)).toBe('sk-abc12345')
    expect(openKey('secret-two', a)).toBeNull()
    expect(openKey('secret-one', a.slice(0, -2) + 'AA')).toBeNull()
    expect(openKey('secret-one', 'garbage')).toBeNull()
  })
})

describe('address guard', () => {
  it.each(['127.0.0.1', '10.1.2.3', '192.168.0.9', '172.20.0.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1', '::ffff:a00:1', '::ffff:7f00:1', '0:0:0:0:0:ffff:a9fe:a9fe', '::10.0.0.1', '::a00:1', '64:ff9b::a00:1', '64:ff9b::10.0.0.1', '2002:a00:1::', '2002:7f00:1::1', '2001:0:1::1', 'ff02::1', '::', '::ffff:0:a00:1', '64:ff9b:1::1', '64:ff9b::808:808', '2001:db8::1', '100::1'])(
    'treats %s as private',
    (ip) => expect(isPrivateAddress(ip)).toBe(true),
  )
  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '::ffff:808:808', '2002:808:808::'])('treats %s as public', (ip) => expect(isPrivateAddress(ip)).toBe(false))
  it.each([
    'http://api.example.com/v1',
    'https://user:pw@api.example.com/v1',
    'https://api.example.com:8443/v1',
    'https://localhost/v1',
    'https://127.0.0.1/v1',
    'https://[::1]/v1',
    'https://[::ffff:10.0.0.1]/v1',
    'https://[::ffff:169.254.169.254]/v1',
    'https://[64:ff9b::a00:1]/v1',
    'https://169.254.169.254/latest',
    'https://db.internal/v1',
    'not a url',
  ])('refuses %s', async (url) => {
    await expect(assertPublicUrl(url)).rejects.toThrow()
  })
  it('accepts a public address literal', async () => {
    await expect(assertPublicUrl('https://8.8.8.8/v1')).resolves.toBeUndefined()
  })
})

let h: Harness
let u: Client
afterEach(async () => {
  await h?.cleanup()
})

const reply = (items: unknown[]) =>
  new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items }) } }] }), { status: 200 })

describe('/nutrition/ai-key', () => {
  async function boot(userKeyFetch?: typeof fetch) {
    h = await setupApp({}, userKeyFetch ? { userKeyFetch } : {})
    u = await signUpClient(h, 'bring-key@example.com')
    await u.call('POST', '/api/v1/me/init')
  }
  const input = { provider: 'openai', base_url: 'https://8.8.8.8/v1', model: 'my-model', api_key: 'sk-secret-key-123' }

  it('saves, never returns the key, and removes it', async () => {
    await boot()
    expect((await u.call('GET', '/api/v1/nutrition/ai-key')).json).toEqual({ configured: false })
    const put = await u.call('PUT', '/api/v1/nutrition/ai-key', input)
    expect(put.status).toBe(200)
    expect(put.json).toEqual({ configured: true, provider: 'openai', base_url: 'https://8.8.8.8/v1', model: 'my-model' })
    const got = await u.call('GET', '/api/v1/nutrition/ai-key')
    expect(JSON.stringify(got.json)).not.toContain('sk-secret')
    expect((await u.call('DELETE', '/api/v1/nutrition/ai-key')).status).toBe(204)
    expect((await u.call('GET', '/api/v1/nutrition/ai-key')).json).toEqual({ configured: false })
  })

  it('refuses a private or non-https address with 400 and stores nothing', async () => {
    await boot()
    for (const base_url of ['https://127.0.0.1/v1', 'http://api.example.com/v1', 'https://169.254.169.254/x']) {
      expect((await u.call('PUT', '/api/v1/nutrition/ai-key', { ...input, base_url })).status).toBe(400)
    }
    expect((await u.call('GET', '/api/v1/nutrition/ai-key')).json).toEqual({ configured: false })
  })

  it('needs a base address for an openai-compatible service', async () => {
    await boot()
    const { base_url: _omit, ...rest } = input
    expect((await u.call('PUT', '/api/v1/nutrition/ai-key', rest)).status).toBe(400)
  })

  it('parse uses the saved key, sends it only to that provider, and takes no daily allowance', async () => {
    const fetchFn = vi.fn(async () => reply([{ name: 'Yogurt', quantity: '1 cup', calories: 150, protein_g: 12 }]))
    await boot(fetchFn as unknown as typeof fetch)
    await u.call('PUT', '/api/v1/nutrition/ai-key', input)
    const res = await u.call('POST', '/api/v1/nutrition/parse', { text: 'yogurt' })
    expect(res.status).toBe(200)
    expect((res.json as { remaining_today: number | null }).remaining_today).toBeNull()
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://8.8.8.8/v1/chat/completions')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-secret-key-123')
  })

  it("one user's key is never used for another user", async () => {
    const fetchFn = vi.fn(async () => reply([]))
    await boot(fetchFn as unknown as typeof fetch)
    await u.call('PUT', '/api/v1/nutrition/ai-key', input)
    const other = await signUpClient(h, 'other-key@example.com')
    await other.call('POST', '/api/v1/me/init')
    expect((await other.call('GET', '/api/v1/nutrition/ai-key')).json).toEqual({ configured: false })
    // the other user falls back to the server's own parser (with its daily allowance), never to this key
    const res = await other.call('POST', '/api/v1/nutrition/parse', { text: 'x' })
    expect(typeof (res.json as { remaining_today: number | null }).remaining_today).toBe('number')
    expect(fetchFn).not.toHaveBeenCalled()
  })
})
