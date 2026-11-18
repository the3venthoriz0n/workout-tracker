import { useSyncExternalStore } from 'react'

// Appearance is a per-device preference: follow the system (default), or force light or dark. Like the rest
// timer it lives in localStorage, so it needs no schema or API change; reads and writes are guarded.
// public/theme-init.js applies the same rule before first paint.
export type ThemePref = 'system' | 'light' | 'dark' | 'color'
// What <html data-theme> holds. "color" is a light scheme with its own palette.
export type Scheme = 'light' | 'dark' | 'color'
const KEY = 'wt.theme'
const BAR: Record<Scheme, string> = { light: '#eceff3', dark: '#090f15', color: '#eaf1fe' }
const listeners = new Set<() => void>()
let memory: ThemePref = 'system' // used when storage is blocked, so the choice still holds for this page load

function read(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark' || v === 'color') return v
    return v === 'system' ? 'system' : memory
  } catch {
    return memory
  }
}

const systemQuery = () => matchMedia('(prefers-color-scheme: dark)')

export function resolveTheme(pref: ThemePref): Scheme {
  return pref === 'system' ? (systemQuery().matches ? 'dark' : 'light') : pref
}

export function applyTheme(pref: ThemePref = read()) {
  const theme = resolveTheme(pref)
  document.documentElement.setAttribute('data-theme', theme)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BAR[theme])
}

export function setThemePref(pref: ThemePref) {
  memory = pref
  try {
    localStorage.setItem(KEY, pref)
  } catch {
    // Not saved; it still applies for this page load
  }
  applyTheme(pref)
  listeners.forEach((l) => l())
}

/** Re-apply when the OS scheme flips while following the system. Call once at start-up. */
export function watchSystemTheme() {
  systemQuery().addEventListener('change', () => read() === 'system' && applyTheme('system'))
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  window.addEventListener('storage', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', listener)
  }
}

export function useThemePref(): ThemePref {
  return useSyncExternalStore(subscribe, read, () => 'system')
}

/** The scheme actually showing (for things drawn by libraries, like toasts). */
export function useResolvedTheme(): 'light' | 'dark' {
  return resolveTheme(useThemePref()) === 'dark' ? 'dark' : 'light'
}
