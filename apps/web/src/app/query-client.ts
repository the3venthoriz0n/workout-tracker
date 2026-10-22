import { QueryClient } from '@tanstack/react-query'

// The app is fully local: never pause queries or mutations when the browser reports offline.
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { networkMode: 'always' },
      mutations: { networkMode: 'always' },
    },
  })
}
