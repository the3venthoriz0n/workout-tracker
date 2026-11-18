import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyTheme, setThemePref } from '../src/lib/theme-pref'

function systemIs(dark: boolean) {
  vi.stubGlobal('matchMedia', () => ({ matches: dark, addEventListener: () => undefined }))
}

describe('theme preference', () => {
  beforeEach(() => {
    localStorage.clear()
    document.head.innerHTML = '<meta name="theme-color" content="#eceff3">'
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
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#eceff3')
    setThemePref('dark')
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#090f15')
  })
})

describe('color theme', () => {
  it('is its own scheme, saved, with its own browser bar colour', () => {
    systemIs(true)
    setThemePref('color')
    expect(document.documentElement.dataset.theme).toBe('color')
    expect(localStorage.getItem('wt.theme')).toBe('color')
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#eaf1fe')
  })
})
