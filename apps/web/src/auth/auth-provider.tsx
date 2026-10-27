import { useQueryClient } from '@tanstack/react-query'
import { UnauthenticatedError, type ApiRepo, type Repo } from '@workout/shared'
import { ProfileNotFoundError } from '@workout/shared'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { SessionPrompt } from '@/components/session-prompt'
import { isOfflineRepo, type OfflineRepo } from '@/repo/offline'
import { RepoProvider } from '@/repo/provider'
import { AuthError, toKind, type AuthClient, type AuthErrorKind } from './client'
import { AuthContext, type AuthState } from './context'
import {
  cancelDiscard as cancelDiscardFlow,
  confirmDiscard as confirmDiscardFlow,
  retryUpload as retryUploadFlow,
  signInFlow,
  signOutFlow,
  signUpFlow,
  type FlowDeps,
  type FlowOutcome,
} from './import-flow'

export { useAuth } from './context'

type Phase = 'ready' | 'pending-upload' | 'confirm-discard'
type S =
  | { kind: 'loading' }
  | { kind: 'guest' }
  | { kind: 'signed-in'; email: string; phase: Phase }
  | { kind: 'expired' }
  | { kind: 'unreachable' }

type LocalWithReset = Repo & { reset(): Promise<void> }

const HINT = 'wt-account-hint'
type HintPhase = 'pending-upload' | 'confirm-discard'
type Hint = { id: string; email: string; phase?: HintPhase }
// The hint remembers that this device is signed in (and as whom) so a cold start without a connection can open
// the account's offline mirror, and it persists an unfinished upload/discard decision across reloads so guest
// data is never wiped without an explicit confirmation.
function setHint(h: Hint | null) {
  try {
    if (h) localStorage.setItem(HINT, h.id ? JSON.stringify(h) : '1')
    else localStorage.removeItem(HINT)
  } catch {
    // storage may be blocked; the hint is only a convenience
  }
}
function readHint(): { present: boolean; id?: string; email?: string; phase?: HintPhase } {
  try {
    const raw = localStorage.getItem(HINT)
    if (!raw) return { present: false }
    try {
      const v = JSON.parse(raw) as Partial<Hint> | null
      if (v && typeof v.id === 'string' && v.id && typeof v.email === 'string') {
        const phase = v.phase === 'pending-upload' || v.phase === 'confirm-discard' ? v.phase : undefined
        return { present: true, id: v.id, email: v.email, phase }
      }
    } catch {
      // legacy hint ('1')
    }
    return { present: true }
  } catch {
    return { present: false }
  }
}

export function AuthProvider({
  auth,
  local,
  createApi,
  children,
}: {
  auth: AuthClient
  local: LocalWithReset
  /** Receives the signed-in account id so a queue and mirror can be kept per account. */
  createApi: (accountId: string) => ApiRepo
  children: ReactNode
}) {
  const queryClient = useQueryClient()
  const [s, setS] = useState<S>({ kind: 'loading' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<AuthErrorKind | null>(null)
  const [verifyEmail, setVerifyEmail] = useState<string | null>(null)
  const busyRef = useRef(false)
  const sRef = useRef(s)
  sRef.current = s
  const [pendingChanges, setPendingChanges] = useState(0)
  const apiRef = useRef<ApiRepo | null>(null)
  const apiAccount = useRef('')
  const unsubApi = useRef<(() => void) | null>(null)
  const accountRef = useRef('') // id of the account this device is (becoming) signed in as
  const goRef = useRef<(next: S) => void>(() => undefined)
  const lastVersion = useRef(0)

  const dropApi = () => {
    unsubApi.current?.()
    unsubApi.current = null
    const old = apiRef.current
    apiRef.current = null
    if (isOfflineRepo(old)) old.dispose()
    setPendingChanges(0)
  }
  // One API repo per account id: switching accounts disposes the old one (and its replay timers).
  const getApi = (): ApiRepo => {
    if (apiRef.current && apiAccount.current === accountRef.current) return apiRef.current
    dropApi()
    const api = createApi(accountRef.current)
    apiRef.current = api
    apiAccount.current = accountRef.current
    if (isOfflineRepo(api)) {
      lastVersion.current = 0
      setPendingChanges(api.pending())
      unsubApi.current = api.subscribe((st) => {
        setPendingChanges(st.pending)
        const cur = sRef.current
        const live = cur.kind === 'signed-in' && cur.phase === 'ready'
        if (st.paused && live) queueMicrotask(() => goRef.current({ kind: 'expired' }))
        else if (st.version !== lastVersion.current) {
          lastVersion.current = st.version
          if (live) void queryClient.invalidateQueries() // replay changed server state: refresh what is on screen
        }
      })
    }
    return api
  }
  const offlineApi = (): OfflineRepo | null => (isOfflineRepo(apiRef.current) ? apiRef.current : null)
  const [attempt, setAttempt] = useState(0)

  // Every state change can swap the repo, so every one drops all cached query data first.
  const go = useCallback(
    (next: S) => {
      queryClient.clear()
      setVerifyEmail(null)
      if (next.kind === 'signed-in') setHint({ id: accountRef.current, email: next.email, phase: next.phase === 'ready' ? undefined : next.phase })
      else if (next.kind === 'guest') setHint(null)
      setS(next)
    },
    [queryClient],
  )
  goRef.current = go

  // Startup (and Retry): who am I?
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      let user
      try {
        user = await auth.session()
      } catch {
        if (cancelled) return
        const hint = readHint()
        if (!hint.present) return go({ kind: 'guest' })
        // Offline cold start: if this account's active workout (or unsent edits) is on the device, open on it.
        // An unfinished upload/discard decision cannot be resolved offline: never skip past it.
        if (hint.phase) return go({ kind: 'unreachable' })
        if (hint.id && hint.email) {
          accountRef.current = hint.id
          const api = getApi()
          if (isOfflineRepo(api) && (await api.hasOfflineData().catch(() => false))) {
            if (!cancelled) go({ kind: 'signed-in', email: hint.email, phase: 'ready' })
            return
          }
        }
        return go({ kind: 'unreachable' })
      }
      if (cancelled) return
      if (!user) return go({ kind: 'guest' })
      accountRef.current = user.userId
      try {
        await getApi().getProfile()
        if (cancelled) return
        // Reload mid-decision: restore the prompt; the guest data on this device was never confirmed away.
        const h = readHint()
        const phase: Phase = h.id === user.userId && h.phase ? h.phase : 'ready'
        go({ kind: 'signed-in', email: user.email, phase })
      } catch (e) {
        if (cancelled) return
        if (e instanceof ProfileNotFoundError) go({ kind: 'signed-in', email: user.email, phase: 'pending-upload' })
        else if (e instanceof UnauthenticatedError) go({ kind: 'expired' })
        else go({ kind: 'unreachable' })
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth, attempt])

  // A 401 while using the account ends the session; never fall back to guest data.
  useEffect(() => {
    const check = (err: unknown) => {
      if (err instanceof UnauthenticatedError && sRef.current.kind === 'signed-in' && sRef.current.phase === 'ready') {
        queueMicrotask(() => go({ kind: 'expired' }))
      }
    }
    const unsubQ = queryClient.getQueryCache().subscribe((ev) => {
      if (ev.type === 'updated' && ev.action.type === 'error') check(ev.action.error)
    })
    const unsubM = queryClient.getMutationCache().subscribe((ev) => {
      if (ev.type === 'updated' && ev.action.type === 'error') check(ev.action.error)
    })
    return () => {
      unsubQ()
      unsubM()
    }
  }, [queryClient, go])

  // Sign-in/up flows learn the account id from the auth reply; the API repo is built for that id afterwards.
  const learn = async (call: () => Promise<{ userId: string; email: string }>) => {
    // Whatever repo is still around belongs to the previous account: stop its replay before the cookie can change.
    offlineApi()?.pause()
    const r = await call()
    accountRef.current = r.userId
    return r
  }
  const flowAuth: AuthClient = {
    ...auth,
    signIn: (e, p) => learn(() => auth.signIn(e, p)),
    signUp: (e, p) => learn(() => auth.signUp(e, p)),
  }
  const deps = (): FlowDeps => ({
    auth: flowAuth,
    local,
    api: {
      getProfile: () => getApi().getProfile(),
      importAll: (d) => (getApi() as ApiRepo).importAll(d),
    },
  })

  const applyOutcome = useCallback(
    (o: FlowOutcome, email: string) => {
      const phase: Phase = o === 'signed-in' || o === 'verify-email' ? 'ready' : o === 'confirm-discard' ? 'confirm-discard' : 'pending-upload'
      go({ kind: 'signed-in', email, phase })
    },
    [go],
  )

  // Serialises actions: a second tap while one is running is ignored.
  async function run(fn: () => Promise<void>) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(toKind(e))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const emailOf = () => {
    const cur = sRef.current
    return cur.kind === 'signed-in' ? cur.email : ''
  }

  const value: AuthState = {
    status: s.kind === 'signed-in' ? 'signed-in' : s.kind,
    email: s.kind === 'signed-in' ? s.email : undefined,
    pendingUpload: s.kind === 'signed-in' && s.phase === 'pending-upload',
    confirmingDiscard: s.kind === 'signed-in' && s.phase === 'confirm-discard',
    pendingChanges: s.kind === 'signed-in' || s.kind === 'expired' ? pendingChanges : 0,
    verifyEmail,
    busy,
    error,
    signUp: (email, password) =>
      run(async () => {
        // No session comes back, so the plain client is used: nothing about an account is learned or switched.
        const o = await signUpFlow({ ...deps(), auth }, email, password)
        if (o === 'verify-email') setVerifyEmail(email)
        else applyOutcome(o, email)
      }),
    signIn: (email, password) =>
      run(async () => {
        if (sRef.current.kind === 'expired') {
          // Re-authenticating: the local DB was already reset, so there is nothing to confirm or upload.
          offlineApi()?.pause()
          const u = await auth.signIn(email, password)
          // Same account: its paused queue carries on. Another account: getApi() builds a fresh repo for the
          // new id and drops the old one, so the previous account's queued edits are never replayed here.
          const same = !!u.userId && u.userId === accountRef.current
          accountRef.current = u.userId
          if (same) offlineApi()?.resume()
          return go({ kind: 'signed-in', email: u.email || email, phase: 'ready' })
        }
        try {
          applyOutcome(await signInFlow(deps(), email, password), email)
        } catch (e) {
          if (e instanceof AuthError && e.kind === 'check_failed') {
            dropApi() // the account check failed: nothing of that account may keep replaying here
            accountRef.current = ''
          }
          throw e
        }
      }),
    signOut: (opts) =>
      run(async () => {
        const off = offlineApi()
        const cur = sRef.current
        if (off && !opts?.discardPending) {
          if (sRef.current.kind === 'signed-in' && off.pending() > 0) await off.flush() // try to send them first
          if (off.pending() > 0) throw new AuthError('unsynced_changes')
        }
        if (sRef.current.kind === 'expired') {
          await auth.signOut().catch(() => undefined) // session is already gone
          await local.reset()
        } else if (cur.kind === 'signed-in' && cur.phase === 'confirm-discard') {
          // The guest data was never confirmed away: only end the server session, keep the local data.
          await auth.signOut()
        } else {
          await signOutFlow(deps())
        }
        // Signed out for real (and, if there were unsent edits, the user said to drop them).
        await off?.clear().catch(() => undefined)
        dropApi()
        accountRef.current = ''
        go({ kind: 'guest' })
      }),
    retryUpload: () =>
      run(async () => {
        const o = await retryUploadFlow(deps())
        if (o === 'upload-failed') toast.error('Upload failed again. Your data on this device is untouched.')
        applyOutcome(o, emailOf())
      }),
    confirmDiscard: () => run(async () => applyOutcome(await confirmDiscardFlow(deps()), emailOf())),
    cancelDiscard: () =>
      run(async () => {
        await cancelDiscardFlow(deps())
        dropApi() // nothing of this account is kept on the device; any queue it has stays keyed to it
        accountRef.current = ''
        go({ kind: 'guest' })
      }),
    retrySession: () => {
      setS({ kind: 'loading' })
      setAttempt((n) => n + 1)
    },
    dismissError: () => setError(null),
    clearVerifyEmail: () => setVerifyEmail(null),
    resendVerification: (email) => auth.resendVerification(email),
    requestPasswordReset: (email) => auth.requestPasswordReset(email),
    resetPassword: (token, pw) => auth.resetPassword(token, pw),
  }

  const apiActive = s.kind === 'signed-in' && s.phase === 'ready'
  const repo: Repo = useMemo(() => (apiActive ? getApi() : local), [apiActive, local]) // eslint-disable-line react-hooks/exhaustive-deps

  let content: ReactNode = null
  if (s.kind === 'expired' || s.kind === 'unreachable') content = <SessionPrompt />
  else if (s.kind !== 'loading')
    content = (
      <RepoProvider key={apiActive ? 'api' : 'local'} repo={repo}>
        {children}
      </RepoProvider>
    )
  return <AuthContext value={value}>{content}</AuthContext>
}
