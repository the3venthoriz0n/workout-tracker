import { useQueryClient } from '@tanstack/react-query'
import { UnauthenticatedError, type ApiRepo, type Repo } from '@workout/shared'
import { ProfileNotFoundError } from '@workout/shared'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { SessionPrompt } from '@/components/session-prompt'
import { RepoProvider } from '@/repo/provider'
import { AuthError, type AuthClient, type AuthErrorKind } from './client'
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
function setHint(on: boolean) {
  try {
    if (on) localStorage.setItem(HINT, '1')
    else localStorage.removeItem(HINT)
  } catch {
    // storage may be blocked; the hint is only a convenience
  }
}
function hasHint(): boolean {
  try {
    return localStorage.getItem(HINT) === '1'
  } catch {
    return false
  }
}

const toKind = (e: unknown): AuthErrorKind => (e instanceof AuthError ? e.kind : 'server')

export function AuthProvider({
  auth,
  local,
  createApi,
  children,
}: {
  auth: AuthClient
  local: LocalWithReset
  createApi: () => ApiRepo
  children: ReactNode
}) {
  const queryClient = useQueryClient()
  const [s, setS] = useState<S>({ kind: 'loading' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<AuthErrorKind | null>(null)
  const busyRef = useRef(false)
  const sRef = useRef(s)
  sRef.current = s
  const apiRef = useRef<ApiRepo | null>(null)
  const getApi = () => (apiRef.current ??= createApi())
  const [attempt, setAttempt] = useState(0)

  // Every state change can swap the repo, so every one drops all cached query data first.
  const go = useCallback(
    (next: S) => {
      queryClient.clear()
      if (next.kind === 'signed-in') setHint(true)
      else if (next.kind === 'guest') setHint(false)
      setS(next)
    },
    [queryClient],
  )

  // Startup (and Retry): who am I?
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      let user
      try {
        user = await auth.session()
      } catch {
        if (!cancelled) go(hasHint() ? { kind: 'unreachable' } : { kind: 'guest' })
        return
      }
      if (cancelled) return
      if (!user) return go({ kind: 'guest' })
      try {
        await getApi().getProfile()
        if (!cancelled) go({ kind: 'signed-in', email: user.email, phase: 'ready' })
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

  const deps = (): FlowDeps => ({ auth, local, api: getApi() })

  const applyOutcome = useCallback(
    (o: FlowOutcome, email: string) => {
      const phase: Phase = o === 'signed-in' ? 'ready' : o === 'confirm-discard' ? 'confirm-discard' : 'pending-upload'
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
    busy,
    error,
    signUp: (email, password) =>
      run(async () => applyOutcome(await signUpFlow(deps(), email, password), email)),
    signIn: (email, password) =>
      run(async () => {
        if (sRef.current.kind === 'expired') {
          // Re-authenticating: the local DB was already reset, so there is nothing to confirm or upload.
          const u = await auth.signIn(email, password)
          return go({ kind: 'signed-in', email: u.email || email, phase: 'ready' })
        }
        applyOutcome(await signInFlow(deps(), email, password), email)
      }),
    signOut: () =>
      run(async () => {
        if (sRef.current.kind === 'expired') {
          await auth.signOut().catch(() => undefined) // session is already gone
          await local.reset()
        } else {
          await signOutFlow(deps())
        }
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
        go({ kind: 'guest' })
      }),
    retrySession: () => {
      setS({ kind: 'loading' })
      setAttempt((n) => n + 1)
    },
    dismissError: () => setError(null),
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
