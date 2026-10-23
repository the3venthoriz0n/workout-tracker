// Drizzle may wrap the driver error; the SQLSTATE lives on the innermost cause.
export function pgCode(err: unknown): string | undefined {
  for (let e: unknown = err, i = 0; e && typeof e === 'object' && i < 5; e = (e as { cause?: unknown }).cause, i++) {
    const code = (e as { code?: unknown }).code
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code
  }
  return undefined
}
export const isUniqueViolation = (err: unknown): boolean => pgCode(err) === '23505'
