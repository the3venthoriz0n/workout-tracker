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
  busy: boolean
  error: AuthErrorKind | null
  signUp(email: string, password: string): Promise<void>
  signIn(email: string, password: string): Promise<void>
  signOut(): Promise<void>
  retryUpload(): Promise<void>
  confirmDiscard(): Promise<void>
  cancelDiscard(): Promise<void>
  retrySession(): void
  dismissError(): void
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const v = use(AuthContext)
  if (!v) throw new Error('useAuth must be used inside AuthProvider')
  return v
}
