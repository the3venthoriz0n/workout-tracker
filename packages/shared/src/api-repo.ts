import {
  AlreadyHasDataError,
  ApiError,
  ConflictError,
  ImportInvalidError,
  NotFoundError,
  OfflineError,
  ProfileNotFoundError,
  PublishLimitError,
  SessionInProgressError,
  UnauthenticatedError,
  ValidationError,
} from './repo.js'
import type { ExportData, FinishSummary, PlanTree, ProgressionRow, Repo, SessionDetail } from './repo.js'
import type { SharedListing } from './community.js'
import type { ExerciseProgression } from './rules.js'
import { newId } from './id.js'
import type { Exercise, Gear, Plan, PlanDay, PlanItem, Profile, SetLog, WorkoutSession } from './schemas.js'

export type ApiRepoOptions = {
  /** Prefix for every request URL (default: same origin, relative URLs). */
  baseUrl?: string
  /** Injectable for tests; defaults to the global fetch. */
  fetch?: typeof fetch
}

export type ApiRepo = Repo & { importAll(data: ExportData): Promise<void> }

type Result = { status: number; data: unknown }

const V1 = '/api/v1'
const seg = encodeURIComponent

/** The body as JSON, or undefined (empty or not JSON). */
export async function readJson(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => '')
  if (!text) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

/** Maps a non-2xx response to a typed error. Only the server's error code is ever surfaced, never the raw body. */
export function responseError(status: number, data: unknown, notFound?: () => Error): Error {
  const code = typeof (data as { error?: unknown } | undefined)?.error === 'string'
    ? ((data as { error: string }).error.slice(0, 64) as string)
    : undefined
  if (status === 401) return new UnauthenticatedError()
  if (status === 404) return notFound ? notFound() : new NotFoundError()
  if (status === 409) {
    if (code === 'session_in_progress') return new SessionInProgressError()
    if (code === 'already_has_data') return new AlreadyHasDataError()
    if (code === 'conflict') return new ConflictError()
  }
  if (status === 429 && code === 'publish_limit') return new PublishLimitError()
  if (status === 400 && code === 'invalid') {
    const issue = (data as { issues?: { path?: unknown }[] } | undefined)?.issues?.[0]
    return new ValidationError(typeof issue?.path === 'string' ? issue.path.slice(0, 200) : '')
  }
  return new ApiError(status, code)
}

export function createApiRepo(opts: ApiRepoOptions = {}): ApiRepo {
  const base = (opts.baseUrl ?? '').replace(/\/+$/, '')

  async function send(method: string, path: string, body?: unknown, notFound?: () => Error): Promise<Result> {
    const stateChanging = method !== 'GET' && method !== 'HEAD'
    const init: RequestInit = { method, credentials: 'include' }
    if (stateChanging) {
      init.headers = { 'Content-Type': 'application/json' }
      init.body = JSON.stringify(body ?? {})
    }
    let res: Response
    try {
      res = await (opts.fetch ?? globalThis.fetch)(`${base}${V1}${path}`, init)
    } catch {
      throw new OfflineError()
    }
    const data = await readJson(res)
    if (res.ok) return { status: res.status, data }
    if (res.status === 400 && path === '/import') throw new ImportInvalidError()
    throw responseError(res.status, data, notFound)
  }

  const get = async <T>(path: string, notFound?: () => Error) => (await send('GET', path, undefined, notFound)).data as T
  const put = async <T>(path: string, body: unknown) => (await send('PUT', path, body)).data as T
  const patch = async <T>(path: string, body: unknown) => (await send('PATCH', path, body)).data as T
  const post = async <T>(path: string, body?: unknown) => (await send('POST', path, body)).data as T
  const del = async (path: string) => {
    await send('DELETE', path)
  }
  const delJson = async <T>(path: string) => (await send('DELETE', path)).data as T
  const profileMissing = () => new ProfileNotFoundError()

  return {
    async init() {
      await post('/me/init')
    },
    getProfile: () => get<Profile>('/me', profileMissing),
    async updateProfile(p) {
      return patch<Profile>('/me', p)
    },
    listGear: () => get<Gear[]>('/gear'),
    saveGear({ id, ...rest }) {
      return put<Gear>(`/gear/${seg(id ?? newId())}`, rest)
    },
    listExercises: () => get<Exercise[]>('/exercises'),
    saveExercise({ id, ...rest }) {
      return put<Exercise>(`/exercises/${seg(id ?? newId())}`, rest)
    },
    deleteExercise: (id) => del(`/exercises/${seg(id)}`),
    async exerciseUsage(id) {
      try {
        return await get<{ planItemCount: number; plans: string[] }>(`/exercises/${seg(id)}/usage`)
      } catch (e) {
        // The route 404s for ids that are not live rows (e.g. just deleted); the Repo contract says zero usage.
        if (e instanceof NotFoundError) return { planItemCount: 0, plans: [] }
        throw e
      }
    },
    deleteGear: (id) => del(`/gear/${seg(id)}`),
    listPlans: () => get<Plan[]>('/plans'),
    async getPlan(id) {
      try {
        return await get<PlanTree>(`/plans/${seg(id)}`)
      } catch (e) {
        if (e instanceof NotFoundError) return undefined
        throw e
      }
    },
    savePlan({ id, ...rest }) {
      return put<Plan>(`/plans/${seg(id ?? newId())}`, rest)
    },
    deletePlan: (id) => del(`/plans/${seg(id)}`),
    savePlanDay({ id, ...rest }) {
      return put<PlanDay>(`/days/${seg(id ?? newId())}`, rest)
    },
    deletePlanDay: (id) => del(`/days/${seg(id)}`),
    addPlanItem(planDayId, exerciseId) {
      return post<PlanItem>(`/days/${seg(planDayId)}/items`, { exercise_id: exerciseId, id: newId() })
    },
    updatePlanItem: (id, p) => patch<PlanItem>(`/items/${seg(id)}`, p),
    deletePlanItem: (id) => del(`/items/${seg(id)}`),
    async setRule(planItemId, rule) {
      await put(`/items/${seg(planItemId)}/rule`, { rule })
    },
    clearRule: (planItemId) => del(`/items/${seg(planItemId)}/rule`),
    async setExerciseRule(exerciseId, rule) {
      await put(`/exercises/${seg(exerciseId)}/rule`, { rule })
    },
    async setSuperset(planDayId, groupId, itemIds) {
      await put(`/days/${seg(planDayId)}/supersets/${seg(groupId)}`, { item_ids: itemIds })
    },
    async move(kind, id, direction) {
      await post('/move', { kind, id, direction })
    },
    async getActiveSession() {
      return (await get<SessionDetail | null>('/sessions/active')) ?? undefined
    },
    startSession: (planDayId) => post<SessionDetail>('/sessions', { plan_day_id: planDayId }),
    updateSet: (id, p) => patch<SetLog>(`/sets/${seg(id)}`, p),
    async updateSessionNote(id, note) {
      await patch(`/sessions/${seg(id)}`, { note })
    },
    finishSession: (id) => post<FinishSummary>(`/sessions/${seg(id)}/complete`),
    discardSession: (id) => del(`/sessions/${seg(id)}`),
    listSessions: () => get<WorkoutSession[]>('/sessions'),
    async getSession(id) {
      try {
        return await get<SessionDetail>(`/sessions/${seg(id)}`)
      } catch (e) {
        if (e instanceof NotFoundError) return undefined
        throw e
      }
    },
    exportAll: () => get<ExportData>('/export', profileMissing),
    listProgression: () => get<ProgressionRow[]>('/progression'),
    listProgressionByExercise: () => get<ExerciseProgression[]>('/progression/exercises'),
    async importAll(data) {
      await post('/import', data)
    },
    publishPlan: (planId, meta) => post(`/plans/${seg(planId)}/publish`, meta),
    unpublishPlan: (planId) => del(`/plans/${seg(planId)}/publish`),
    listMyShared: () => get<SharedListing[]>('/shared-plans/mine'),
    // Never sends a snapshot: the server loads it by id.
    adoptSharedPlan: ({ shared_plan_id, version }) =>
      post(`/shared-plans/${seg(shared_plan_id)}/adopt`, version === undefined ? {} : { version }),
    setVote: (id, voted) =>
      voted ? put(`/shared-plans/${seg(id)}/vote`, {}) : delJson(`/shared-plans/${seg(id)}/vote`),
    async hasVoted(id) {
      return (await get<{ voted: boolean }>(`/shared-plans/${seg(id)}/vote`)).voted === true
    },
  }
}
