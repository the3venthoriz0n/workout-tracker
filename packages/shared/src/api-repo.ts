import {
  AlreadyHasDataError,
  ApiError,
  ConflictError,
  ImportInvalidError,
  NotFoundError,
  OfflineError,
  ProfileNotFoundError,
  SessionInProgressError,
  UnauthenticatedError,
} from './repo.js'
import type { ExportData, FinishSummary, PlanTree, ProgressionRow, Repo, SessionDetail } from './repo.js'
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
    const text = await res.text().catch(() => '')
    let data: unknown
    if (text) {
      try {
        data = JSON.parse(text)
      } catch {
        data = undefined
      }
    }
    if (res.ok) return { status: res.status, data }
    // Only the server's error code is ever surfaced, never the raw body.
    const code = typeof (data as { error?: unknown } | undefined)?.error === 'string'
      ? ((data as { error: string }).error.slice(0, 64) as string)
      : undefined
    if (res.status === 401) throw new UnauthenticatedError()
    if (res.status === 404) throw notFound ? notFound() : new NotFoundError()
    if (res.status === 409) {
      if (code === 'session_in_progress') throw new SessionInProgressError()
      if (code === 'already_has_data') throw new AlreadyHasDataError()
      if (code === 'conflict') throw new ConflictError()
    }
    if (res.status === 400 && path === '/import') throw new ImportInvalidError()
    throw new ApiError(res.status, code)
  }

  const get = async <T>(path: string, notFound?: () => Error) => (await send('GET', path, undefined, notFound)).data as T
  const put = async <T>(path: string, body: unknown) => (await send('PUT', path, body)).data as T
  const patch = async <T>(path: string, body: unknown) => (await send('PATCH', path, body)).data as T
  const post = async <T>(path: string, body?: unknown) => (await send('POST', path, body)).data as T
  const del = async (path: string) => {
    await send('DELETE', path)
  }
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
    async importAll(data) {
      await post('/import', data)
    },
  }
}
