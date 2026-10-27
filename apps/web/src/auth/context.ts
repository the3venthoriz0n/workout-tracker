import { createContext, use } from 'react'
import type { AuthErrorKind } from './client'

export type AuthStatus = 'loading' | 'guest' | 'signed-in' | 'expired' | 'unreachable'

export type AuthState = {
  status: AuthStatus
  email?: string
  /** Signed in, but the guest data has not reached the server yet (upload failed). */
  pendingUpload: boolean
  /** Signed in to an account that has data; waiting for the user to confirm discarding guest data. */
  confirmingDiscard: boolean
  /** Set edits queued while offline that have not reached the server (0 in guest mode). */
  pendingChanges: number
  /** Address a verification mail was just sent to (guest, no session yet); null otherwise. */
  verifyEmail: string | null
  busy: boolean
  error: AuthErrorKind | null
  signUp(email: string, password: string): Promise<void>
  signIn(email: string, password: string): Promise<void>
  /** With unsent edits this refuses (error 'unsynced_changes') unless `discardPending` says the user confirmed. */
  signOut(opts?: { discardPending?: boolean }): Promise<void>
  retryUpload(): Promise<void>
  confirmDiscard(): Promise<void>
  cancelDiscard(): Promise<void>
  retrySession(): void
  dismissError(): void
  clearVerifyEmail(): void
  /**
   * Deletes the account after the server checked the password, then forgets everything of it on
   * this device (queries, outbox, mirror, hint) and starts a fresh guest database. Resolves to the
   * error kind (nothing changed) or null on success; never touches `error`.
   */
  deleteAccount(password: string): Promise<AuthErrorKind | null>
  /** Plain pass-throughs: they do not touch the session state. */
  resendVerification(email: string): Promise<void>
  requestPasswordReset(email: string): Promise<void>
  resetPassword(token: string, newPassword: string): Promise<void>
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const v = use(AuthContext)
  if (!v) throw new Error('useAuth must be used inside AuthProvider')
  return v
}

/**
 * True when the app talks to the account (signed in and past any upload/discard decision).
 * Safe outside AuthProvider (tests, previews): no provider means guest.
 */
export function useSignedIn(): boolean {
  const v = use(AuthContext)
  return !!v && v.status === 'signed-in' && !v.pendingUpload && !v.confirmingDiscard
}
