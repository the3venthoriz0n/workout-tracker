import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router/dom'
import { createApiRepo } from '@workout/shared'
import { AuthProvider } from './auth/auth-provider'
import { createAuthClient } from './auth/client'
import { createQueryClient } from './app/query-client'
import { createRouter } from './app/router'
import './index.css'
import { followSystemTheme } from './lib/theme'
import { AppDb } from './repo/db'
import { LocalRepo } from './repo/local-repo'

followSystemTheme()

const queryClient = createQueryClient()
const repo = new LocalRepo(new AppDb('workout-tracker'))
const authClient = createAuthClient()
const router = createRouter()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider auth={authClient} local={repo} createApi={() => createApiRepo()}>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)
