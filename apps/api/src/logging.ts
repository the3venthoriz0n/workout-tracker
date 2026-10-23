// Log hygiene. Drizzle query errors carry `params:` (password hashes, session tokens) in their
// message and in `cause`; request data never gets logged at all. Everything that reaches the
// console goes through here.

export type SafeError = { name: string; code?: string; message: string }

/** Drop everything from a `params:` section on (Drizzle: "Failed query: ...\nparams: ..."). */
function stripParams(message: string): string {
  const i = message.search(/\n?\s*params:/i)
  return (i === -1 ? message : message.slice(0, i)).trim()
}

function codeOf(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined
  const code = (err as { code?: unknown }).code
  if (typeof code === 'string' || typeof code === 'number') return String(code)
  const cause = (err as { cause?: unknown }).cause
  return cause && cause !== err ? codeOf(cause) : undefined
}

/** Name, code (own or from `cause`, e.g. Postgres 23505) and a parameter-free message. `cause` itself is never printed. */
export function sanitizeError(err: unknown): SafeError {
  if (err instanceof Error) {
    const code = codeOf(err)
    const name = err.name !== 'Error' ? err.name : (err.constructor?.name ?? 'Error') // Drizzle errors keep name 'Error'
    return { name, ...(code ? { code } : {}), message: stripParams(err.message) }
  }
  return { name: 'NonError', message: typeof err === 'string' ? stripParams(err) : typeof err }
}

function sanitizeArg(arg: unknown): unknown {
  if (arg instanceof Error) return sanitizeError(arg)
  if (typeof arg === 'string') return stripParams(arg)
  if (typeof arg === 'number' || typeof arg === 'boolean' || arg == null) return arg
  return '[object omitted]'
}

/** Better Auth `logger.log` implementation. */
export function sanitizedLog(level: 'debug' | 'info' | 'warn' | 'error', message: string, ...args: unknown[]): void {
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  sink(`[auth:${level}] ${stripParams(message)}`, ...args.map(sanitizeArg))
}
