import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createCaptureMailer,
  createConsoleMailer,
  createResendMailer,
  logMailFailure,
  mailerFromEnv,
  resetEmail,
  setupEmail,
  throttled,
  verificationEmail,
  type Mail,
} from '../src/mail.js'

const KEY = 'test-resend-key-123'
const FROM = 'Workout Tracker <no-reply@example.invalid>'
const mail: Mail = { to: 'lifter@example.com', subject: 'Hello', text: 'plain', html: '<p>plain</p>' }

afterEach(() => {
  vi.restoreAllMocks()
})

function fakeFetch(status: number, body = '{}') {
  const calls: { url: string; init: RequestInit }[] = []
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(body, { status })
  }) as unknown as typeof fetch
  return { fn, calls }
}

describe('createResendMailer', () => {
  it('posts the message to the Resend API with a bearer key', async () => {
    const f = fakeFetch(200, '{"id":"x"}')
    await createResendMailer({ apiKey: KEY, from: FROM, fetch: f.fn }).send(mail)
    expect(f.calls).toHaveLength(1)
    const { url, init } = f.calls[0]!
    expect(url).toBe('https://api.resend.com/emails')
    expect(init.method).toBe('POST')
    const headers = new Headers(init.headers)
    expect(headers.get('authorization')).toBe(`Bearer ${KEY}`)
    expect(headers.get('content-type')).toBe('application/json')
    expect(JSON.parse(init.body as string)).toEqual({ from: FROM, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html })
  })

  for (const status of [400, 401, 422, 429, 500, 503]) {
    it(`rejects on HTTP ${status} with the status only (no key, no body, no recipient)`, async () => {
      const f = fakeFetch(status, JSON.stringify({ message: `bad key ${KEY}`, to: mail.to }))
      const err = await createResendMailer({ apiKey: KEY, from: FROM, fetch: f.fn })
        .send(mail)
        .then(
          () => undefined,
          (e: unknown) => e as Error,
        )
      expect(err).toBeInstanceOf(Error)
      expect(err!.message).toContain(String(status))
      expect(JSON.stringify({ message: err!.message, ...err })).not.toContain(KEY)
      expect(err!.message).not.toContain(mail.to)
    })
  }

  it('a network failure rejects without the key or the message body', async () => {
    const boom = (async () => {
      throw new TypeError(`fetch failed for ${KEY} ${mail.text}`)
    }) as unknown as typeof fetch
    const err = await createResendMailer({ apiKey: KEY, from: FROM, fetch: boom })
      .send(mail)
      .then(
        () => undefined,
        (e: unknown) => e as Error,
      )
    expect(err).toBeInstanceOf(Error)
    expect(err!.message).not.toContain(KEY)
    expect(JSON.stringify(err)).not.toContain(KEY)
    expect((err as Error & { cause?: unknown }).cause).toBeUndefined()
  })
})

describe('createConsoleMailer and createCaptureMailer', () => {
  it('the console mailer prints recipient, subject and body with a [mail] prefix', async () => {
    const lines: string[] = []
    await createConsoleMailer((l) => lines.push(l)).send({ ...mail, text: 'open https://example.invalid/x?token=abc' })
    const out = lines.join('\n')
    expect(out).toMatch(/^\[mail\]/)
    expect(out).toContain(mail.to)
    expect(out).toContain('https://example.invalid/x?token=abc')
  })

  it('the capture mailer records every message', async () => {
    const m = createCaptureMailer()
    await m.send(mail)
    await m.send({ ...mail, subject: 'Two' })
    expect(m.sent.map((s) => s.subject)).toEqual(['Hello', 'Two'])
  })
})

describe('throttled', () => {
  it('allows 3 per recipient and subject per hour, silently drops the rest, resets after the window', async () => {
    let now = 0
    const inner = createCaptureMailer()
    const m = throttled(inner, { now: () => now })
    for (let i = 0; i < 5; i++) await expect(m.send(mail)).resolves.toBeUndefined()
    expect(inner.sent).toHaveLength(3)
    // Letter case of the address does not open a new bucket.
    await m.send({ ...mail, to: 'LIFTER@Example.com' })
    expect(inner.sent).toHaveLength(3)
    // Another kind of message, or another recipient (plus-addressing is a different address), has its own bucket.
    await m.send({ ...mail, subject: 'Other kind' })
    await m.send({ ...mail, to: 'lifter+gym@example.com' })
    expect(inner.sent).toHaveLength(5)
    now = 60 * 60 * 1000 - 1
    await m.send(mail)
    expect(inner.sent).toHaveLength(5)
    now = 60 * 60 * 1000 + 1
    await m.send(mail)
    expect(inner.sent).toHaveLength(6)
  })

  it('honours max and windowMs', async () => {
    let now = 0
    const inner = createCaptureMailer()
    const m = throttled(inner, { max: 1, windowMs: 1000, now: () => now })
    await m.send(mail)
    await m.send(mail)
    expect(inner.sent).toHaveLength(1)
    now = 1001
    await m.send(mail)
    expect(inner.sent).toHaveLength(2)
  })

  it('passes failures of the inner mailer through', async () => {
    const m = throttled({ send: () => Promise.reject(new Error('down')) })
    await expect(m.send(mail)).rejects.toThrow('down')
  })
})

describe('message builders', () => {
  const link = 'https://app.example.com/api/auth/verify-email?token=abc.def&callbackURL=%2Fverified'
  for (const [name, build] of [
    ['verificationEmail', verificationEmail],
    ['resetEmail', resetEmail],
    ['setupEmail', setupEmail],
  ] as const) {
    it(`${name}: link in text and html only, plain html without remote content`, () => {
      const m = build('lifter@example.com', link)
      expect(m.to).toBe('lifter@example.com')
      expect(m.subject).not.toContain('token')
      expect(m.subject).not.toContain('http')
      expect(m.text).toContain(link)
      expect(m.html).toContain(link.replaceAll('&', '&amp;'))
      expect(m.html).not.toMatch(/<img|<script|<link|src=|url\(/i)
    })
  }

  it('the two kinds have different subjects (the throttle keys on it)', () => {
    const subjects = [verificationEmail, resetEmail, setupEmail].map((b) => b('a@example.com', link).subject)
    expect(new Set(subjects).size).toBe(3)
    expect(setupEmail('a@example.com', link).text.toLowerCase()).toContain('finish setting up your account: choose your password')
  })

  it('escapes the link in html', () => {
    const m = resetEmail('a@example.com', 'https://example.invalid/?a="<b>"')
    expect(m.html).not.toContain('"<b>"')
  })
})

describe('logMailFailure', () => {
  it('logs the error name and code only, never the message', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    logMailFailure(new Error('could not send https://example.invalid/reset?token=secret-token'))
    const out = JSON.stringify(err.mock.calls)
    expect(out).toContain('[mail]')
    expect(out).not.toContain('secret-token')
  })
})

describe('mailerFromEnv', () => {
  it('development without RESEND_API_KEY or MAIL_FROM uses the console mailer', async () => {
    const lines: string[] = []
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    for (const env of [
      { NODE_ENV: 'development' as const },
      { NODE_ENV: 'development' as const, RESEND_API_KEY: KEY },
      { NODE_ENV: 'development' as const, MAIL_FROM: FROM },
    ]) {
      await mailerFromEnv(env, (l) => lines.push(l)).send(mail)
    }
    expect(lines.filter((l) => l.startsWith('[mail]'))).toHaveLength(3)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('with both set it sends through Resend, throttled per recipient', async () => {
    const f = fakeFetch(200)
    vi.spyOn(globalThis, 'fetch').mockImplementation(f.fn)
    const m = mailerFromEnv({ NODE_ENV: 'production', RESEND_API_KEY: KEY, MAIL_FROM: FROM }, () => {})
    for (let i = 0; i < 5; i++) await m.send(mail)
    expect(f.calls).toHaveLength(3)
    expect(f.calls[0]!.url).toBe('https://api.resend.com/emails')
  })

  it('production without the settings throws instead of falling back to the console', () => {
    expect(() => mailerFromEnv({ NODE_ENV: 'production' }, () => {})).toThrow()
  })
})
