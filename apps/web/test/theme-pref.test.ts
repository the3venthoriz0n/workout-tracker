import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyTheme, setThemePref } from '../src/lib/theme-pref'

function systemIs(dark: boolean) {
  vi.stubGlobal('matchMedia', () => ({ matches: dark, addEventListener: () => undefined }))
}

describe('theme preference', () => {
  beforeEach(() => {
    localStorage.clear()
    document.head.innerHTML = '<meta name="theme-color" content="#fdfcfc">'
  })

  it('follows the system by default', () => {
    systemIs(true)
    applyTheme()
    expect(document.documentElement.dataset.theme).toBe('dark')
    systemIs(false)
    applyTheme()
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('a chosen scheme beats the system, is saved, and recolours the browser bar', () => {
    systemIs(true)
    setThemePref('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(localStorage.getItem('wt.theme')).toBe('light')
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#fdfcfc')
    setThemePref('dark')
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#090f15')
  })
})
