import { afterEach, expect, test, vi } from 'vitest'
import { followSystemTheme } from '../src/lib/theme'

afterEach(() => vi.unstubAllGlobals())

test('followSystemTheme is a no-op without matchMedia', () => {
  vi.stubGlobal('matchMedia', undefined)
  const stop = followSystemTheme()
  expect(document.documentElement.classList.contains('dark')).toBe(false)
  expect(() => stop()).not.toThrow()
})

test('followSystemTheme applies the dark class and cleans up its listener', () => {
  let listener: (() => void) | undefined
  const query = {
    matches: true,
    addEventListener: (_: string, l: () => void) => (listener = l),
    removeEventListener: () => (listener = undefined),
  }
  vi.stubGlobal('matchMedia', () => query)
  const stop = followSystemTheme()
  expect(document.documentElement.classList.contains('dark')).toBe(true)
  expect(listener).toBeDefined()
  stop()
  expect(listener).toBeUndefined()
  document.documentElement.classList.remove('dark')
})
