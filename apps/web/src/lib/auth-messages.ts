import type { AuthErrorKind } from '@/auth/client'

export const AUTH_ERROR_TEXT: Record<AuthErrorKind, string> = {
  invalid_credentials: 'Email or password is incorrect.',
  rate_limited: 'Too many attempts. Wait a minute and try again.',
  offline: "Can't reach the server. Check your connection and try again.",
  email_taken: "That email can't be used for a new account. Try signing in instead.",
  invalid_input: 'Check the email and password and try again.',
  server: 'Something went wrong on our side. Try again in a moment.',
  unsynced_changes: "Some changes haven't reached the server yet. Reconnect and try again, or sign out and discard them.",
  check_failed: "Couldn't check your account, so nothing was changed. Try again.",
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateCredentials(email: string, password: string): string | null {
  if (!EMAIL_RE.test(email.trim())) return 'Enter a valid email address.'
  if (password.length < 10 || password.length > 128) return 'Password must be 10 to 128 characters.'
  return null
}
