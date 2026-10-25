import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { routes } from '../src/app/router'
import { AppDb } from '../src/repo/db'
import { LocalRepo } from '../src/repo/local-repo'
import { RepoProvider } from '../src/repo/provider'

/** A fresh guest repo with the seed data, plus a lookup of seeded exercises by name. */
export async function freshRepo(prefix: string) {
  const repo = new LocalRepo(new AppDb(`${prefix}-${crypto.randomUUID()}`))
  await repo.init()
  const exercises = await repo.listExercises()
  const byName = (n: string) => {
    const e = exercises.find((x) => x.name === n)
    if (!e) throw new Error(`no seed exercise ${n}`)
    return e
  }
  return { repo, byName }
}

export function renderAt(repo: LocalRepo, path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RepoProvider repo={repo}>
        <RouterProvider router={router} />
      </RepoProvider>
    </QueryClientProvider>,
  )
  return router
}
