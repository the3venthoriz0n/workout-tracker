// Community plans on the web: the public client bound to the app's API base, labels and the
// messages for publish and adopt errors. Everything from the public API is untrusted: it is only
// ever rendered as React text (never as HTML, never as a link target).
import {
  ConflictError,
  NotFoundError,
  OfflineError,
  PublishLimitError,
  ValidationError,
  displayNameSchema,
  fetchCommunityList,
  fetchCommunityPlan,
  type Level,
  type PublicListQuery,
} from '@workout/shared'
import { useEffect, useState } from 'react'
import { API_BASE_URL } from '@/api'

export const publicApi = {
  list: (params: PublicListQuery) => fetchCommunityList(params, { baseUrl: API_BASE_URL }),
  plan: (id: string, version?: number) => fetchCommunityPlan(id, { baseUrl: API_BASE_URL, version }),
}

export const LEVEL_NAMES: Record<Level, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
}

/** Compact counts for cards: 1234 -> "1.2k". */
export function compactCount(n: number): string {
  if (n < 1000) return String(n)
  if (n < 10_000) return `${(Math.floor(n / 100) / 10).toString()}k`
  if (n < 1_000_000) return `${Math.floor(n / 1000)}k`
  return `${Math.floor(n / 100_000) / 10}M`
}

/** The shared schemas' message for text that contains a link. */
export const LINK_MESSAGE = 'Links are not allowed'

export const OFFLINE_TEXT = "You're offline. Reconnect and try again."
export const GONE_TEXT = "This plan isn't shared anymore."

/** Message for a failed "Use this plan". */
export function adoptErrorText(err: unknown): string {
  if (err instanceof OfflineError) return OFFLINE_TEXT
  if (err instanceof NotFoundError) return GONE_TEXT
  if (err instanceof ValidationError) return "This plan can't be copied into your units. Nothing was added."
  return "Couldn't add this plan. Try again."
}

export type PublishErrors = Partial<Record<'display_name' | 'title' | 'description' | 'level' | 'form', string>>

/** Field errors (or a form-level message) for a failed publish. */
export function publishErrors(err: unknown): PublishErrors {
  if (err instanceof PublishLimitError) return { form: 'You can publish 5 times a day. Try again tomorrow.' }
  if (err instanceof OfflineError) return { form: OFFLINE_TEXT }
  if (err instanceof ConflictError) return { form: 'This plan was removed from Community and can’t be shared again.' }
  if (err instanceof ValidationError) {
    const field = err.path.split('.')[0]
    if (field === 'display_name') return { display_name: 'Set a valid public name first.' }
    if (field === 'title') return { title: 'Check the title.' }
    if (field === 'description') return { description: 'Check the description.' }
    if (field === 'level') return { level: 'Pick a level or leave it empty.' }
    // Local pre-checks carry a readable message; the server's 400 only carries the path.
    if (err.message && err.message !== 'Invalid request') return { form: err.message }
    return { form: "This plan can't be shared yet. Check that every day has exercises." }
  }
  return { form: "Couldn't publish. Try again." }
}

/** The value after it has stopped changing for `ms`. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/** Public name rules (spec §3): 2-30 letters, digits, spaces, _ - . */
export function displayNameError(name: string): string | null {
  const r = displayNameSchema.safeParse(name)
  if (r.success) return null
  const trimmed = name.trim()
  if (trimmed.length < 2 || trimmed.length > 30) return 'Use 2 to 30 characters.'
  if (r.error.issues.some((i) => i.message === LINK_MESSAGE)) return "A public name can't look like a link."
  return 'Use letters, digits, spaces, _ - . only.'
}
