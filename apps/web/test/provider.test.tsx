import { render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import { AppDb } from '../src/repo/db'
import { LocalRepo } from '../src/repo/local-repo'
import { RepoProvider } from '../src/repo/provider'
import type { Repo } from '../src/repo/types'

afterEach(() => {
  vi.restoreAllMocks()
})

const freshRepo = () => new LocalRepo(new AppDb(`provider-${crypto.randomUUID()}`))

test('init runs once under StrictMode', async () => {
  const repo = freshRepo()
  const init = vi.spyOn(repo, 'init')
  render(
    <StrictMode>
      <RepoProvider repo={repo}>
        <p>child</p>
      </RepoProvider>
    </StrictMode>,
  )
  expect(await screen.findByText('child')).toBeTruthy()
  expect(init).toHaveBeenCalledTimes(1)
})

test('children render only after init resolves', async () => {
  const repo = freshRepo()
  let resolve!: () => void
  vi.spyOn(repo, 'init').mockReturnValue(new Promise<void>((r) => (resolve = r)))
  render(
    <RepoProvider repo={repo}>
      <p>child</p>
    </RepoProvider>,
  )
  expect(screen.queryByText('child')).toBeNull()
  resolve()
  expect(await screen.findByText('child')).toBeTruthy()
})

test('a failing init shows the fallback with a Reload button', async () => {
  const repo = freshRepo()
  vi.spyOn(repo, 'init').mockRejectedValue(new Error('blocked'))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  render(
    <RepoProvider repo={repo as Repo}>
      <p>child</p>
    </RepoProvider>,
  )
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(screen.getByText(/Couldn.t open local storage/)).toBeTruthy()
  expect(screen.getByText(/Error: blocked/)).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy()
  expect(screen.queryByText('child')).toBeNull()
})
