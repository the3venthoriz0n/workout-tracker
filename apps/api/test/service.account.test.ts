// deleteAccount retries a deadlock or serialization failure once, then answers a clean "try again".
import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { mapDomainError } from '../src/routes/http.js'
import { TryAgainError, deleteAccount } from '../src/service/account.js'
import type { Db } from '../src/db/types.js'

const pgError = (code: string) => Object.assign(new Error('failed query'), { cause: Object.assign(new Error(code), { code }) })

describe('deleteAccount on a transient database conflict', () => {
  for (const code of ['40P01', '40001']) {
    it(`${code}: retries once, then succeeds`, async () => {
      const transaction = vi.fn().mockRejectedValueOnce(pgError(code)).mockResolvedValueOnce(undefined)
      await deleteAccount({ transaction } as unknown as Db, 'u1')
      expect(transaction).toHaveBeenCalledTimes(2)
    })

    it(`${code} twice: TryAgainError, never the raw error`, async () => {
      const transaction = vi.fn().mockRejectedValue(pgError(code))
      const err = await deleteAccount({ transaction } as unknown as Db, 'u1').catch((e: unknown) => e)
      expect(err).toBeInstanceOf(TryAgainError)
      expect(transaction).toHaveBeenCalledTimes(2)
    })
  }

  it('any other error is not retried', async () => {
    const transaction = vi.fn().mockRejectedValue(pgError('23503'))
    const err = await deleteAccount({ transaction } as unknown as Db, 'u1').catch((e: unknown) => e)
    expect(err).not.toBeInstanceOf(TryAgainError)
    expect(transaction).toHaveBeenCalledTimes(1)
  })

  it('TryAgainError maps to 503 {"error":"try_again"} with Retry-After', async () => {
    const app = new Hono()
    app.get('/x', () => {
      throw new TryAgainError()
    })
    app.onError((err, c) => mapDomainError(err, c) ?? c.json({ error: 'internal_error' }, 500))
    const res = await app.request('/x')
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'try_again' })
    expect(res.headers.get('retry-after')).toBe('1')
  })
})
