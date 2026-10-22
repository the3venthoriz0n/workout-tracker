import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import { useActiveSession, usePlan, useSession } from '../src/repo/hooks'
import { AppDb } from '../src/repo/db'
import { LocalRepo } from '../src/repo/local-repo'
import { RepoProvider } from '../src/repo/provider'

afterEach(() => {
  vi.restoreAllMocks()
})

function wrapper() {
  const repo = new LocalRepo(new AppDb(`hooks-${crypto.randomUUID()}`))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <RepoProvider repo={repo}>{children}</RepoProvider>
    </QueryClientProvider>
  )
}

test('"none" results settle as success with null data', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  const w = wrapper()
  const active = renderHook(() => useActiveSession(), { wrapper: w })
  const plan = renderHook(() => usePlan('nope'), { wrapper: w })
  const session = renderHook(() => useSession('nope'), { wrapper: w })
  for (const r of [active, plan, session]) {
    await waitFor(() => expect(r.result.current.isSuccess).toBe(true))
    expect(r.result.current.data).toBeNull()
  }
  expect(errors).not.toHaveBeenCalled()
  errors.mockRestore()
})
