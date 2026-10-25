import type { Context } from 'hono'
import {
  AlreadyHasDataError,
  ConflictError,
  IdParam,
  ImportInvalidError,
  NotFoundError,
  ProfileNotFoundError,
  SessionInProgressError,
  ValidationError,
} from '@workout/shared'
import type { z } from 'zod'
import type { AppEnv } from '../middleware.js'
import type { Service } from '../service/index.js'

export type Ctx = Context<AppEnv>
export type Issue = { path: string; message: string }

/** Thrown for any request the client got wrong; mapped to 400 {"error":"invalid","issues":[...]}. */
export class InvalidRequestError extends Error {
  constructor(readonly issues: Issue[]) {
    super('Invalid request')
    this.name = 'InvalidRequestError'
  }
}

const MAX_ISSUES = 20

/** Issues carry a dotted path and zod's message only; submitted values are never echoed. */
function toIssues(error: z.ZodError, prefix: string[] = []): Issue[] {
  return error.issues
    .slice(0, MAX_ISSUES)
    .map((i) => ({ path: [...prefix, ...i.path.map(String)].join('.'), message: i.message }))
}

export function parse<S extends z.ZodType>(schema: S, data: unknown, prefix: string[] = []): z.infer<S> {
  const r = schema.safeParse(data)
  if (!r.success) throw new InvalidRequestError(toIssues(r.error, prefix))
  return r.data
}

/** The only place a user id comes from: the session middleware. */
export const service = (c: Ctx, getService: (userId: string) => Service): Service => getService(c.var.userId)

export function param(c: Ctx, name: string): string {
  return parse(IdParam, c.req.param(name), [name])
}

export async function body<S extends z.ZodType>(c: Ctx, schema: S): Promise<z.infer<S>> {
  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    throw new InvalidRequestError([{ path: '', message: 'Body must be valid JSON' }])
  }
  return parse(schema, raw)
}

/** Maps domain errors to HTTP. Returns undefined for anything else (the caller sends the sanitized 500). */
export function mapDomainError(err: unknown, c: Context): Response | undefined {
  if (err instanceof InvalidRequestError) return c.json({ error: 'invalid', issues: err.issues }, 400)
  if (err instanceof ValidationError) {
    return c.json({ error: 'invalid', issues: [{ path: err.path, message: err.message }] }, 400)
  }
  if (err instanceof ImportInvalidError) {
    return c.json({ error: 'invalid', issues: [{ path: '', message: err.message }] }, 400)
  }
  if (err instanceof NotFoundError || err instanceof ProfileNotFoundError) return c.json({ error: 'not_found' }, 404)
  if (err instanceof SessionInProgressError) return c.json({ error: 'session_in_progress' }, 409)
  if (err instanceof AlreadyHasDataError) return c.json({ error: 'already_has_data' }, 409)
  if (err instanceof ConflictError) return c.json({ error: 'conflict' }, 409)
  return undefined
}
