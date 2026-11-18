import { useQuery } from '@tanstack/react-query'
import { AuthError } from './client'

// "Continue with Google": the server does the OAuth round trip and comes back to the app with a session
// cookie. Before leaving, a marker is stored so the next start knows this was a sign-in (not a plain
// reload) and runs the same guest-data steps as a password sign-in.
const MARKER = 'wt-google-return'

export function markGoogleReturn() {
  try {
    sessionStorage.setItem(MARKER, '1')
  } catch {
    // blocked storage: the account is still signed in, only the guest-data prompt is skipped
  }
}

/** True once per return from Google. */
export function consumeGoogleReturn(): boolean {
  try {
    const on = sessionStorage.getItem(MARKER) === '1'
    sessionStorage.removeItem(MARKER)
    return on
  } catch {
    return false
  }
}

/** Starts the redirect to Google. Resolves only if it failed to leave the page. */
export async function startGoogleSignIn(opts: { fetch?: typeof fetch; go?: (url: string) => void } = {}): Promise<void> {
  const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis)
  let res: Response
  try {
    res = await doFetch('/api/auth/sign-in/social', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'google', callbackURL: '/settings', errorCallbackURL: '/settings' }),
    })
  } catch {
    throw new AuthError('offline')
  }
  if (res.status === 429) throw new AuthError('rate_limited')
  const url = ((await res.json().catch(() => null)) as { url?: unknown } | null)?.url
  if (!res.ok || typeof url !== 'string') throw new AuthError('server')
  markGoogleReturn()
  ;(opts.go ?? ((u: string) => window.location.assign(u)))(url)
}

/** Whether the server has Google sign-in configured. Any failure means "no": the button stays hidden. */
export function useGoogleEnabled(): boolean {
  const q = useQuery({
    queryKey: ['auth-config'],
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      try {
        const res = await fetch('/api/auth-config')
        if (!res.ok) return { google: false }
        const data = (await res.json().catch(() => null)) as { google?: unknown } | null
        return { google: data?.google === true }
      } catch {
        return { google: false }
      }
    },
  })
  return q.data?.google === true
}
