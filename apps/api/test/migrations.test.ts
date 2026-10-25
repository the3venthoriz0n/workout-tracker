import { describe, expect, it } from 'vitest'
import { runMigrations } from '../src/migrations.js'
import type { Db } from '../src/db/types.js'

describe('runMigrations', () => {
  it('throws instead of silently skipping when the migrations folder is missing', async () => {
    await expect(runMigrations({} as Db, '/nonexistent-migrations')).rejects.toThrow(/Migrations not found/)
  })
})
