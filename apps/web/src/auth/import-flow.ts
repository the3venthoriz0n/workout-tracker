import { AlreadyHasDataError, ProfileNotFoundError, type ExportData } from '@workout/shared'
import { AuthError, type AuthClient } from './client'

// Spec section 7. Pure sequencing over injected sides, so every path is unit-testable.
export type LocalSide = { exportAll(): Promise<ExportData>; reset(): Promise<void> }
export type ApiSide = { getProfile(): Promise<unknown>; importAll(data: ExportData): Promise<void> }
export type FlowDeps = { auth: AuthClient; local: LocalSide; api: ApiSide }

/**
 * signed-in: the API repo is now authoritative. confirm-discard: signed in, account has data,
 * waiting for the user to decide. upload-failed: signed in, guest data kept, retry available.
 * verify-email: the account exists but has no session until the email is confirmed.
 */
export type FlowOutcome = 'signed-in' | 'confirm-discard' | 'upload-failed' | 'verify-email'

// Upload guest data; clear it locally only after the server confirmed.
async function upload({ local, api }: FlowDeps): Promise<FlowOutcome> {
  try {
    await api.importAll(await local.exportAll())
  } catch (e) {
    return e instanceof AlreadyHasDataError ? 'confirm-discard' : 'upload-failed'
  }
  await local.reset()
  return 'signed-in'
}

export async function signUpFlow(deps: FlowDeps, email: string): Promise<FlowOutcome> {
  // No session yet: guest data is neither uploaded nor cleared. The first successful sign-in does that.
  await deps.auth.signUp(email)
  return 'verify-email'
}

export async function signInFlow(deps: FlowDeps, email: string, password: string): Promise<FlowOutcome> {
  await deps.auth.signIn(email, password)
  try {
    await deps.api.getProfile()
  } catch (e) {
    if (e instanceof ProfileNotFoundError) return upload(deps) // new, empty account
    // Fail closed: cannot tell whether the account has data, so keep the guest data and the guest session.
    try {
      await deps.auth.signOut()
    } catch {
      // The session cookie survives and we cannot tell what the account holds: stay signed in with the guest
      // data untouched and let "Retry upload" decide (it lands on the discard prompt if the account has data).
      return 'upload-failed'
    }
    throw new AuthError('check_failed')
  }
  return 'confirm-discard'
}

export const retryUpload = upload

export async function confirmDiscard({ local }: FlowDeps): Promise<FlowOutcome> {
  await local.reset()
  return 'signed-in'
}

// Throws if the server sign-out failed: the caller must then stay on the prompt, not fall back to guest mode.
export async function cancelDiscard({ auth }: FlowDeps): Promise<void> {
  await auth.signOut()
}

// Server sign-out first; on failure nothing local changes and the error surfaces.
export async function signOutFlow({ auth, local }: FlowDeps): Promise<void> {
  await auth.signOut()
  await local.reset()
}
