import { createContext, use, useEffect, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import type { Repo } from './types'

const RepoContext = createContext<Repo | null>(null)

// StrictMode mounts effects twice; init must still run once per repo.
const inits = new WeakMap<Repo, Promise<void>>()
function initOnce(repo: Repo): Promise<void> {
  let p = inits.get(repo)
  if (!p) {
    p = repo.init()
    inits.set(repo, p)
  }
  return p
}

function InitFailed({ error }: { error: unknown }) {
  return (
    <div
      role="alert"
      className="bg-background text-foreground flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center"
    >
      <p className="max-w-sm text-sm">
        Couldn&apos;t open local storage. Private browsing or blocked site data can cause this.
      </p>
      <p className="text-muted-foreground max-w-sm font-mono text-xs break-words">
        {String(error).slice(0, 300)}
      </p>
      <Button onClick={() => window.location.reload()}>Reload</Button>
    </div>
  )
}

export function RepoProvider({ repo, children }: { repo: Repo; children: ReactNode }) {
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    let cancelled = false
    initOnce(repo).then(
      () => {
        if (!cancelled) setState('ready')
      },
      (e: unknown) => {
        console.error('Local storage init failed', e)
        if (!cancelled) {
          setError(e)
          setState('failed')
        }
      },
    )
    return () => {
      cancelled = true
    }
  }, [repo])

  if (state === 'failed') return <InitFailed error={error} />
  if (state === 'loading') return null
  return <RepoContext value={repo}>{children}</RepoContext>
}

export function useRepo(): Repo {
  const repo = use(RepoContext)
  if (!repo) throw new Error('useRepo must be used inside RepoProvider')
  return repo
}
