import { useSyncExternalStore } from 'react'

// The rest timer is a per-device preference, off by default. It lives in localStorage rather than the
// profile so it needs no schema or API change; reads and writes are guarded (storage can be blocked).
const KEY = 'wt.restTimer'
const listeners = new Set<() => void>()

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === 'on'
  } catch {
    return false
  }
}

export function setRestTimerEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off')
  } catch {
    // Not saved; the switch still follows the value for this page load only
  }
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  window.addEventListener('storage', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', listener)
  }
}

export function useRestTimerEnabled(): boolean {
  return useSyncExternalStore(subscribe, read, () => false)
}
