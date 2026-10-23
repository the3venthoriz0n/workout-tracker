// Per-call isolated Postgres schema in DATABASE_URL_TEST, with the committed migrations applied.
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../src/db/schema.js'
import type { Db } from '../src/db/types.js'

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url))

// drizzle-kit writes foreign keys as REFERENCES "public"."table", which would point out of the
// test schema. The committed SQL is applied here with that qualifier removed so every
// reference resolves through search_path. Production applies the SQL unchanged.
function migrationStatements(): string[] {
  const journal = JSON.parse(readFileSync(`${migrationsFolder}/meta/_journal.json`, 'utf8')) as {
    entries: { tag: string }[]
  }
  return journal.entries.flatMap(({ tag }) =>
    readFileSync(`${migrationsFolder}/${tag}.sql`, 'utf8')
      .replaceAll('"public".', '')
      .split('--> statement-breakpoint')
      .map((q) => q.trim())
      .filter(Boolean),
  )
}

export type TestDb = { db: Db; schemaName: string; cleanup(): Promise<void> }

export async function withTestDb(): Promise<TestDb> {
  const url = process.env.DATABASE_URL_TEST
  if (!url) {
    throw new Error(
      'DATABASE_URL_TEST is not set. Run tests through `just test` / `just check` (they start the db-test service), or point it at a throwaway Postgres.',
    )
  }
  const schemaName = `t_${randomBytes(8).toString('hex')}`

  // Setup connection without a search_path, only to create the schema.
  const admin = postgres(url, { max: 1, onnotice: () => {} })
  try {
    await admin.unsafe(`CREATE SCHEMA "${schemaName}"`)
  } finally {
    await admin.end()
  }

  // Every pooled connection starts with search_path set to the test schema.
  const client = postgres(url, {
    max: 5,
    onnotice: () => {},
    connection: { search_path: schemaName },
  })
  const db: Db = drizzle(client, { schema })
  try {
    await client.begin(async (tx) => {
      for (const statement of migrationStatements()) await tx.unsafe(statement)
    })
  } catch (err) {
    await client.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).catch(() => {})
    await client.end()
    throw err
  }

  return {
    db,
    schemaName,
    async cleanup() {
      try {
        await client.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
      } finally {
        await client.end()
      }
    },
  }
}
