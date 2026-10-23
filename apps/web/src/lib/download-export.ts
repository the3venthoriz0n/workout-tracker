import type { Repo } from '@/repo/types'

// Builds the export from the given repo and triggers a browser download.
export async function downloadExport(repo: Pick<Repo, 'exportAll'>): Promise<void> {
  const data = await repo.exportAll()
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `workout-tracker-export-${new Date().toISOString().slice(0, 10)}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
