// Shared bits for the community tests: a stubbed public API (plain fetch), a signed-in auth
// context without the real AuthProvider, and sample public data.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { PublicListing, PublicPlanDetail, SharedSnapshot } from '@workout/shared'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { vi } from 'vitest'
import { routes } from '../src/app/router'
import { AuthContext, type AuthState } from '../src/auth/context'
import { AppDb } from '../src/repo/db'
import { LocalRepo } from '../src/repo/local-repo'
import { RepoProvider } from '../src/repo/provider'
import type { Repo } from '../src/repo/types'

export const LISTING_ID = '00000000-0000-4000-8000-0000000000aa'

export function listing(over: Partial<PublicListing> = {}): PublicListing {
  return {
    id: LISTING_ID,
    title: 'Strong Start',
    description: 'Three full-body days.',
    level: 'beginner',
    author: 'Sam Lifts',
    day_count: 2,
    version: 2,
    upvotes: 12,
    downloads: 40,
    updated_at: '2026-10-01T00:00:00.000Z',
    ...over,
  }
}

export const snapshot: SharedSnapshot = {
  name: 'Strong Start',
  units: 'lb',
  days: [
    {
      name: 'Day A',
      color: 'blue',
      items: [
        { exercise: 'Back Squat', gear: ['Barbell'], supports_angle: false, sets: 5, reps: 5, weight: 135, angle: null, amrap_last: true, superset: null, rule: null },
        { exercise: 'Bench Press', gear: ['Barbell', 'Bench'], supports_angle: true, sets: 3, reps: 8, weight: 95, angle: 'incline', amrap_last: false, superset: null, rule: null },
      ],
    },
    {
      name: 'Day B',
      color: null,
      items: [
        { exercise: 'Push-up', gear: [], supports_angle: false, sets: 3, reps: 10, weight: 0, angle: null, amrap_last: false, superset: 'A', rule: null },
        { exercise: 'Bodyweight Squat', gear: [], supports_angle: false, sets: 3, reps: 15, weight: 0, angle: null, amrap_last: false, superset: 'A', rule: null },
      ],
    },
  ],
}

export function detail(over: Partial<PublicListing> = {}, version = 2): PublicPlanDetail {
  return { listing: listing({ version, ...over }), version, snapshot }
}

type Handler = (url: URL) => Response | Promise<Response> | undefined
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** Stubs global fetch; `handle` gets every request URL. Returns the spy (calls carry the URL string). */
export function stubFetch(handle: Handler) {
  const spy = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://app.example.invalid')
    const res = await handle(url)
    if (!res) throw new TypeError('Failed to fetch')
    return res
  })
  vi.stubGlobal('fetch', spy)
  return spy
}
export const requestedUrls = (spy: ReturnType<typeof stubFetch>) =>
  spy.mock.calls.map(([u]) => new URL(String(u), 'http://app.example.invalid'))

export async function guestRepo(prefix = 'comm') {
  const repo = new LocalRepo(new AppDb(`${prefix}-${crypto.randomUUID()}`))
  await repo.init()
  return repo
}

function authState(signedIn: boolean): AuthState {
  const noop = async () => {}
  return {
    status: signedIn ? 'signed-in' : 'guest',
    email: signedIn ? 'me@example.invalid' : undefined,
    pendingUpload: false,
    confirmingDiscard: false,
    pendingChanges: 0,
    verifyEmail: null,
    busy: false,
    error: null,
    signUp: noop,
    signIn: noop,
    signOut: noop,
    retryUpload: noop,
    confirmDiscard: noop,
    cancelDiscard: noop,
    retrySession: () => undefined,
    dismissError: () => undefined,
    clearVerifyEmail: () => undefined,
    resendVerification: noop,
    requestPasswordReset: noop,
    resetPassword: noop,
    deleteAccount: async () => null,
    restoreData: async () => null,
  }
}

/** Renders the app routes at `path`. `signedIn` provides a signed-in auth context (the repo is whatever is passed). */
export function renderApp(repo: Repo, path: string, opts: { signedIn?: boolean } = {}) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const tree = (
    <QueryClientProvider client={client}>
      <RepoProvider repo={repo}>
        <RouterProvider router={router} />
      </RepoProvider>
    </QueryClientProvider>
  )
  render(opts.signedIn === undefined ? tree : <AuthContext value={authState(opts.signedIn)}>{tree}</AuthContext>)
  return { router, client }
}
