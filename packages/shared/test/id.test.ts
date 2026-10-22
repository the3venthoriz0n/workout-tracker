import { afterEach, describe, expect, it, vi } from 'vitest'
import { newId } from '../src/id.js'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function insecureCrypto(fill: (bytes: Uint8Array) => void) {
  vi.stubGlobal('crypto', {
    randomUUID: undefined,
    getRandomValues: <T extends ArrayBufferView>(arr: T) => {
      fill(arr as unknown as Uint8Array)
      return arr
    },
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('newId', () => {
  it('returns a v4 UUID with native randomUUID', () => {
    expect(newId()).toMatch(UUID_V4)
  })

  it('returns a v4 UUID without randomUUID (insecure context)', () => {
    const real = globalThis.crypto
    insecureCrypto((b) => real.getRandomValues(b as Uint8Array<ArrayBuffer>))
    expect(newId()).toMatch(UUID_V4)
  })

  it('does not collide across 1000 ids', () => {
    expect(new Set(Array.from({ length: 1000 }, newId)).size).toBe(1000)
  })

  it('does not collide across 1000 fallback ids', () => {
    const real = globalThis.crypto
    insecureCrypto((b) => real.getRandomValues(b as Uint8Array<ArrayBuffer>))
    expect(new Set(Array.from({ length: 1000 }, newId)).size).toBe(1000)
  })

  it('sets version and variant bits (all 0xff)', () => {
    insecureCrypto((b) => b.fill(0xff))
    expect(newId()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff')
  })

  it('sets version and variant bits (all zero)', () => {
    insecureCrypto((b) => b.fill(0))
    expect(newId()).toBe('00000000-0000-4000-8000-000000000000')
  })
})
