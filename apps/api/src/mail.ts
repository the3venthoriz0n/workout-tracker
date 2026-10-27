// Outgoing email: verification and password-reset links (M2b).
// Production sends through Resend's HTTP API with plain fetch (no SDK); development prints to the
// API log; tests capture. Nothing here ever logs an API key, a token or a link, except the
// development console mailer, whose whole job is to print the link.
import type { Env } from './env.js'

export type Mail = { to: string; subject: string; text: string; html: string }

export interface Mailer {
  send(mail: Mail): Promise<void>
}

/** A send failure that carries a short code only (never the key, recipient, link or provider body). */
export class MailSendError extends Error {
  override name = 'MailSendError'
  constructor(readonly code: string) {
    super(`mail send failed: ${code}`)
  }
}

const RESEND_URL = 'https://api.resend.com/emails'

export function createResendMailer(opts: { apiKey: string; from: string; fetch?: typeof fetch }): Mailer {
  const doFetch = opts.fetch ?? globalThis.fetch
  return {
    async send(mail) {
      let res: Response
      try {
        res = await doFetch(RESEND_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: opts.from, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html }),
          signal: AbortSignal.timeout(10_000),
        })
      } catch {
        // The original error is dropped on purpose: it can carry the request.
        throw new MailSendError('network')
      }
      // Drain the body so the connection is reused; its content is never logged.
      await res.text().catch(() => '')
      if (!res.ok) throw new MailSendError(`http_${res.status}`)
    },
  }
}

/** Development only: prints the message, link included, to the API log. */
export function createConsoleMailer(log: (line: string) => void = console.log): Mailer {
  return {
    async send(mail) {
      log(`[mail] to=${mail.to} subject=${JSON.stringify(mail.subject)}\n${mail.text}`)
    },
  }
}

export function createCaptureMailer(): Mailer & { sent: Mail[] } {
  const sent: Mail[] = []
  return {
    sent,
    async send(mail) {
      sent.push(mail)
    },
  }
}

/**
 * At most `max` messages per (recipient, subject) in `windowMs` (default 3 an hour); the rest are
 * dropped silently, so the caller's answer never changes. The recipient is compared in lower case;
 * plus-addressed variants are different addresses and count separately.
 */
export function throttled(inner: Mailer, opts: { max?: number; windowMs?: number; now?: () => number } = {}): Mailer {
  const max = opts.max ?? 3
  const windowMs = opts.windowMs ?? 60 * 60 * 1000
  const now = opts.now ?? Date.now
  const buckets = new Map<string, { start: number; count: number }>()
  return {
    send(mail) {
      const t = now()
      // Bounded by the number of distinct recipients in one window; expired buckets are swept.
      if (buckets.size > 10_000) for (const [k, b] of buckets) if (t - b.start >= windowMs) buckets.delete(k)
      const key = `${mail.to.trim().toLowerCase()}\n${mail.subject}`
      const b = buckets.get(key)
      if (!b || t - b.start >= windowMs) buckets.set(key, { start: t, count: 1 })
      else if (b.count >= max) return Promise.resolve()
      else b.count++
      return inner.send(mail)
    },
  }
}

const escapeHtml = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')

function build(to: string, subject: string, lines: string[], link: string, action: string): Mail {
  const text = [...lines, '', link, ''].join('\n')
  const paragraphs = lines.filter(Boolean).map((l) => `<p>${escapeHtml(l)}</p>`)
  const html = `<!doctype html><html><body>${paragraphs.join('')}<p><a href="${escapeHtml(link)}">${escapeHtml(action)}</a></p><p>${escapeHtml(link)}</p></body></html>`
  return { to, subject, text, html }
}

export function verificationEmail(to: string, link: string): Mail {
  return build(
    to,
    'Confirm your email',
    [
      'Confirm your email to finish creating your Workout Tracker account.',
      'The link works once and expires in 24 hours. If you did not sign up, ignore this email.',
    ],
    link,
    'Confirm email',
  )
}

export function resetEmail(to: string, link: string): Mail {
  return build(
    to,
    'Reset your password',
    [
      'Someone asked to reset the password of your Workout Tracker account.',
      'The link works once and expires in 1 hour. Resetting signs you out everywhere. If it was not you, ignore this email: your password stays the same.',
    ],
    link,
    'Reset password',
  )
}

/** Logs a failed send as name and code only: a message could hold the link. */
export function logMailFailure(err: unknown): void {
  const name = err instanceof Error ? err.name : typeof err
  const code = err instanceof MailSendError ? err.code : undefined
  console.error('[mail] send failed', code ? { name, code } : { name })
}

/**
 * Resend (throttled per recipient) when both settings are present, otherwise the console mailer.
 * Production never falls back to the console (env.ts already refuses to start without them).
 */
export function mailerFromEnv(
  env: Pick<Env, 'NODE_ENV'> & Partial<Pick<Env, 'RESEND_API_KEY' | 'MAIL_FROM'>>,
  log?: (line: string) => void,
): Mailer {
  if (env.RESEND_API_KEY && env.MAIL_FROM) return throttled(createResendMailer({ apiKey: env.RESEND_API_KEY, from: env.MAIL_FROM }))
  if (env.NODE_ENV === 'production') throw new Error('RESEND_API_KEY and MAIL_FROM are required in production')
  return createConsoleMailer(log)
}
