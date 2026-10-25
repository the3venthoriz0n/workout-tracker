import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { useWakeLock } from '../src/lib/wake-lock'

afterEach(() => {
  vi.unstubAllGlobals()
  Reflect.deleteProperty(navigator, 'wakeLock')
})

function stubWakeLock(request: (type: 'screen') => Promise<{ release: () => Promise<void> }>) {
  Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true })
}

test('acquires the screen lock while active and releases it when done', async () => {
  const release = vi.fn(() => Promise.resolve())
  const request = vi.fn(() => Promise.resolve({ release }))
  stubWakeLock(request)
  const { rerender } = renderHook(({ on }) => useWakeLock(on), { initialProps: { on: true } })
  await waitFor(() => expect(request).toHaveBeenCalledWith('screen'))
  rerender({ on: false })
  await waitFor(() => expect(release).toHaveBeenCalledTimes(1))
})

test('re-acquires the lock when the page becomes visible again', async () => {
  const request = vi.fn(() => Promise.resolve({ release: () => Promise.resolve() }))
  stubWakeLock(request)
  let state: DocumentVisibilityState = 'visible'
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => state)
  const { unmount } = renderHook(() => useWakeLock(true))
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1))
  state = 'hidden'
  document.dispatchEvent(new Event('visibilitychange'))
  state = 'visible'
  document.dispatchEvent(new Event('visibilitychange'))
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
  unmount()
  vi.restoreAllMocks()
})

test('does nothing when inactive, unsupported or refused', async () => {
  const request = vi.fn(() => Promise.reject(new Error('NotAllowedError')))
  stubWakeLock(request)
  renderHook(() => useWakeLock(false))
  expect(request).not.toHaveBeenCalled()
  const { unmount } = renderHook(() => useWakeLock(true))
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1))
  expect(() => unmount()).not.toThrow()
  Reflect.deleteProperty(navigator, 'wakeLock')
  expect(() => renderHook(() => useWakeLock(true)).unmount()).not.toThrow()
})
