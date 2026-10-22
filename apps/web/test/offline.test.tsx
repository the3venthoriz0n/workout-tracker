import { onlineManager, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { afterEach, expect, test } from 'vitest'
import { routes } from '../src/app/router'
import { createQueryClient } from '../src/app/query-client'
import { AppDb } from '../src/repo/db'
import { LocalRepo } from '../src/repo/local-repo'
import { RepoProvider } from '../src/repo/provider'

afterEach(() => {
  cleanup()
  onlineManager.setOnline(true)
})

test('the Today flow works while the browser reports offline', async () => {
  const repo = new LocalRepo(new AppDb(`offline-${crypto.randomUUID()}`))
  await repo.init()
  const ex = (await repo.listExercises()).find((e) => e.name === 'Bench Press')!
  const plan = await repo.savePlan({ name: 'Strength' })
  const day = await repo.savePlanDay({ plan_id: plan.id, name: 'Day A' })
  const item = await repo.addPlanItem(day.id, ex.id)
  await repo.updatePlanItem(item.id, { sets: 3, reps: 5, weight: 95 })

  onlineManager.setOnline(false)
  const user = userEvent.setup()
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RepoProvider repo={repo}>
        <RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/'] })} />
      </RepoProvider>
    </QueryClientProvider>,
  )
  await user.click(await screen.findByRole('button', { name: 'Start workout' }))
  await screen.findAllByText('5 × 95 lb')
  await user.click(screen.getByRole('button', { name: /^Set 1:/ }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /^Set 1:/ }).getAttribute('aria-pressed')).toBe('true'),
  )
  await user.click(screen.getByRole('button', { name: 'Finish workout' }))
  expect(await screen.findByRole('button', { name: 'Done' })).toBeTruthy()
})
