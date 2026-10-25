import { useEffect } from 'react'

type Sentinel = { release: () => Promise<void> }
type WakeLockApi = { request: (type: 'screen') => Promise<Sentinel> }

// Keeps the screen on while `active` (e.g. during a workout). Feature-detected and silent on
// failure; the browser drops the lock when the page is hidden, so it is re-requested on return.
export function useWakeLock(active: boolean) {
  useEffect(() => {
    const api = (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock
    if (!active || !api) return
    let sentinel: Sentinel | null = null
    let stopped = false
    let requesting = false

    const acquire = () => {
      if (document.visibilityState !== 'visible' || sentinel || requesting) return
      requesting = true
      api.request('screen').then(
        (s) => {
          requesting = false
          if (stopped) void s.release().catch(() => undefined)
          else sentinel = s
        },
        () => {
          requesting = false
        },
      )
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') acquire()
      else sentinel = null // released by the browser
    }

    acquire()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stopped = true
      document.removeEventListener('visibilitychange', onVisibility)
      void sentinel?.release().catch(() => undefined)
      sentinel = null
    }
  }, [active])
}
