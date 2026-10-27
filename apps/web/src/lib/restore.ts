import { ApiError, ImportInvalidError, OfflineError, UnauthenticatedError, parseImport, type ExportData } from '@workout/shared'
import { AUTH_ERROR_TEXT } from '@/lib/auth-messages'

/** Same cap as the server's body limit for an export file. */
export const MAX_RESTORE_BYTES = 10 * 1024 * 1024

export type RestoreErrorKind =
  | 'invalid_file'
  | 'too_big'
  | 'invalid_password'
  | 'has_published'
  | 'rate_limited'
  | 'offline'
  | 'session_expired'
  | 'server'

const UNCHANGED = 'Nothing was changed.'

export const RESTORE_ERROR_TEXT: Record<RestoreErrorKind, string> = {
  invalid_file: `This file isn't a valid export from this app, or it's damaged. ${UNCHANGED}`,
  too_big: `This file is too big (the limit is 10 MB). ${UNCHANGED}`,
  invalid_password: `${AUTH_ERROR_TEXT.invalid_password} ${UNCHANGED}`,
  has_published: `You have shared plans in Community. Unpublish them first (Plans, then the plan's share button), then try again. ${UNCHANGED}`,
  rate_limited: `${AUTH_ERROR_TEXT.rate_limited} ${UNCHANGED}`,
  offline: `${AUTH_ERROR_TEXT.offline} ${UNCHANGED}`,
  session_expired: `${AUTH_ERROR_TEXT.session_expired} ${UNCHANGED}`,
  server: `${AUTH_ERROR_TEXT.server} ${UNCHANGED}`,
}

/** Maps whatever a restore threw to a message kind; never shows the raw error. */
export function restoreErrorKind(e: unknown): RestoreErrorKind {
  if (e instanceof ImportInvalidError) return 'invalid_file'
  if (e instanceof OfflineError) return 'offline'
  if (e instanceof UnauthenticatedError) return 'session_expired'
  if (e instanceof ApiError) {
    if (e.status === 403 && e.code === 'invalid_password') return 'invalid_password'
    if (e.status === 409 && e.code === 'has_published') return 'has_published'
    if (e.status === 429) return 'rate_limited'
    if (e.status === 413) return 'too_big'
  }
  return 'server'
}

async function readText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text()
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error ?? new Error('read failed'))
    r.readAsText(file)
  })
}

/**
 * Reads and validates a chosen file with the same rules the server and LocalRepo use. Nothing is
 * written. Too big files are refused before reading them.
 */
export async function readExportFile(file: File): Promise<{ data: ExportData } | { error: RestoreErrorKind }> {
  if (file.size > MAX_RESTORE_BYTES) return { error: 'too_big' }
  try {
    const raw: unknown = JSON.parse(await readText(file))
    // Validate a copy: parseImport may normalise rows, and the original is what gets sent.
    parseImport(structuredClone(raw))
    return { data: raw as ExportData }
  } catch {
    return { error: 'invalid_file' }
  }
}

export type RestoreSummary = { plans: number; exercises: number; workouts: number; units: string; exportedAt: string | null }

/** What the file holds, as the user knows it: live plans and exercises, finished workouts. */
export function summarize(d: ExportData): RestoreSummary {
  const date = Date.parse(d.exported_at)
  return {
    plans: d.plans.filter((p) => p.deleted_at === null).length,
    exercises: d.exercises.filter((e) => e.deleted_at === null).length,
    workouts: d.workout_sessions.filter((s) => s.deleted_at === null && s.completed_at !== null).length,
    units: d.profile.units,
    exportedAt: Number.isNaN(date) ? null : new Date(date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }),
  }
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
