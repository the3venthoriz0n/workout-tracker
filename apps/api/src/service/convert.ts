import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { dec, num } from './mappers.js'

// Helpers for rewriting stored weights in bulk: rows are matched on the distinct values present, so
// cost is bounded by the number of distinct weights, not rows.

/** CASE col WHEN old THEN new ... ELSE col END over the distinct values present. */
export function remap(column: AnyPgColumn, mapping: Map<number, number>): SQL {
  const whens = [...mapping].map(([from, to]) => sql`when ${dec(from)}::numeric then ${dec(to)}::numeric`)
  return sql`case ${column} ${sql.join(whens, sql` `)} else ${column} end`
}

export const distinctNumbers = (values: (string | null)[]): number[] => [
  ...new Set(values.filter((v): v is string => v !== null).map(num)),
]

export function mapping(values: number[], convert: (w: number) => number): Map<number, number> {
  return new Map(values.map((v) => [v, convert(v)]))
}
