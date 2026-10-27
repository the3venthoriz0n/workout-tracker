import type { AuthErrorKind } from '@/auth/client'

export const AUTH_ERROR_TEXT: Record<AuthErrorKind, string> = {
  invalid_credentials: 'Email or password is incorrect.',
  rate_limited: 'Too many attempts. Wait a minute and try again.',
  offline: "Can't reach the server. Check your connection and try again.",
  email_taken: "That email can't be used for a new account. Try signing in instead.",
  signup_closed: 'Sign-up is invite-only. Ask the owner to add your email.',
  invalid_input: 'Check the email and password and try again.',
  server: 'Something went wrong on our side. Try again in a moment.',
  unsynced_changes: "Some changes haven't reached the server yet. Reconnect and try again, or sign out and discard them.",
  email_not_verified: 'Confirm your email first. Open the link we sent you, then sign in.',
  invalid_token: 'This link has expired. Request a new one.',
  invalid_password: 'Password is incorrect.',
  session_expired: 'Your session has ended. Sign in again, then try again.',
  check_failed: "Couldn't check your account, so nothing was changed. Try again.",
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateCredentials(email: string, password: string): string | null {
  if (!EMAIL_RE.test(email.trim())) return 'Enter a valid email address.'
  if (password.length < 10 || password.length > 128) return 'Password must be 10 to 128 characters.'
  return null
}

export const RESET_SENT_TEXT = 'If that address has an account, we sent a link.'
export const RESEND_SENT_TEXT = 'If that address is waiting to be set up, we sent a new link.'
export const EMAIL_INVALID_TEXT = 'Enter a valid email address.'
export const isEmail = (email: string) => EMAIL_RE.test(email.trim())
