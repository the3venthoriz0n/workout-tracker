import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router/dom'
import { createQueryClient } from './app/query-client'
import { createRouter } from './app/router'
import './index.css'
import { followSystemTheme } from './lib/theme'
import { AppDb } from './repo/db'
import { LocalRepo } from './repo/local-repo'
import { RepoProvider } from './repo/provider'

followSystemTheme()

const queryClient = createQueryClient()
const repo = new LocalRepo(new AppDb('workout-tracker'))
const router = createRouter()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RepoProvider repo={repo}>
        <RouterProvider router={router} />
      </RepoProvider>
    </QueryClientProvider>
  </StrictMode>,
)
