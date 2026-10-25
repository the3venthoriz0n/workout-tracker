import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router/dom'
import { createApiRepo } from '@workout/shared'
import { toast } from 'sonner'
import { AuthProvider } from './auth/auth-provider'
import { createAuthClient } from './auth/client'
import { createQueryClient } from './app/query-client'
import { createRouter } from './app/router'
import './index.css'
import { followSystemTheme } from './lib/theme'
import { AppDb } from './repo/db'
import { LocalRepo } from './repo/local-repo'
import { withOffline } from './repo/offline'
import { OutboxDb, createOutboxStore, dropOtherMirrors } from './repo/outbox'

followSystemTheme()

const queryClient = createQueryClient()
const repo = new LocalRepo(new AppDb('workout-tracker'))
const authClient = createAuthClient()
const router = createRouter()
const outboxDb = new OutboxDb()

// Signed-in repo: the REST client plus the per-account set-edit outbox and active-session mirror.
function createAccountRepo(accountId: string) {
  const api = createApiRepo()
  if (!accountId) return api // unknown account: never share a queue between accounts
  void dropOtherMirrors(outboxDb, accountId).catch(() => undefined)
  return withOffline(api, createOutboxStore(outboxDb, accountId), {
    onDropped: () => toast.error("A change made while offline was rejected by the server and couldn't be saved."),
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider auth={authClient} local={repo} createApi={createAccountRepo}>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)
