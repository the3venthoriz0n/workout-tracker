import { useSyncExternalStore } from 'react'

// "Show both units" is a per-device display preference, off by default. Like the rest timer it lives in
// localStorage, so it needs no schema or API change; reads and writes are guarded (storage can be blocked).
const KEY = 'wt.showBothUnits'
const listeners = new Set<() => void>()

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === 'on'
  } catch {
    return false
  }
}

export function setShowBothUnits(on: boolean) {
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

export function useShowBothUnits(): boolean {
  return useSyncExternalStore(subscribe, read, () => false)
}
