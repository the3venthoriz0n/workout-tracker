import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { idSchema, type PublicListQuery } from '@workout/shared'
import { publicApi } from '@/lib/community'
import { useRepo } from './provider'
import type { Repo } from './types'

export const keys = {
  profile: ['profile'] as const,
  gear: ['gear'] as const,
  exercises: ['exercises'] as const,
  plans: ['plans'] as const,
  plan: (id: string) => ['plan', id] as const,
  activeSession: ['session', 'active'] as const,
  sessions: ['sessions'] as const,
  session: (id: string) => ['session', id] as const,
  progressionByExercise: ['progression', 'by-exercise'] as const,
  exerciseUsage: (id: string) => ['exercise-usage', id] as const,
  communityList: (q: Omit<PublicListQuery, 'cursor'>) => ['community', 'list', q] as const,
  communityPlan: (id: string) => ['community', 'plan', id] as const,
  voted: (id: string) => ['community', 'voted', id] as const,
  myShared: ['community', 'mine'] as const,
  nutrition: (date: string) => ['nutrition', date] as const,
}

export const useProfile = () => {
  const repo = useRepo()
  return useQuery({ queryKey: keys.profile, queryFn: () => repo.getProfile() })
}
export const useGear = () => {
  const repo = useRepo()
  return useQuery({ queryKey: keys.gear, queryFn: () => repo.listGear() })
}
export const useExercises = () => {
  const repo = useRepo()
  return useQuery({ queryKey: keys.exercises, queryFn: () => repo.listExercises() })
}
export const useExerciseUsage = (id: string, enabled: boolean) => {
  const repo = useRepo()
  return useQuery({
    queryKey: keys.exerciseUsage(id),
    queryFn: () => repo.exerciseUsage(id),
    enabled,
    retry: false, // surface a failed check immediately so the delete confirm can fail closed
  })
}
export const usePlans = () => {
  const repo = useRepo()
  return useQuery({ queryKey: keys.plans, queryFn: () => repo.listPlans() })
}
export const planQueryOptions = (repo: Repo, id: string) => ({
  queryKey: keys.plan(id),
  queryFn: async () => (await repo.getPlan(id)) ?? null,
})
export const usePlan = (id: string) => {
  const repo = useRepo()
  return useQuery(planQueryOptions(repo, id))
}
export const useActiveSession = () => {
  const repo = useRepo()
  return useQuery({ queryKey: keys.activeSession, queryFn: async () => (await repo.getActiveSession()) ?? null })
}
export const useSessions = () => {
  const repo = useRepo()
  return useQuery({ queryKey: keys.sessions, queryFn: () => repo.listSessions() })
}
/** The most recent completed workout of the same plan day, for the "last time" lines. */
export const usePreviousSession = (planDayId: string, excludeId: string) => {
  const repo = useRepo()
  const sessions = useSessions().data
  const previousId = sessions?.find((s) => s.plan_day_id === planDayId && s.id !== excludeId)?.id
  return useQuery({
    queryKey: keys.session(previousId ?? ''),
    queryFn: async () => (await repo.getSession(previousId!)) ?? null,
    enabled: previousId !== undefined,
  })
}
export const useSession = (id: string) => {
  const repo = useRepo()
  return useQuery({ queryKey: keys.session(id), queryFn: async () => (await repo.getSession(id)) ?? null })
}

/** Every live exercise once, with its effective default rule, overriding items and inheriting items. */
export const useProgressionByExercise = () => {
  const repo = useRepo()
  return useQuery({ queryKey: keys.progressionByExercise, queryFn: () => repo.listProgressionByExercise() })
}

// Mutations touch many cached views (plan trees, effective targets, sessions), so each
// one invalidates everything: correctness over cleverness. Multi-argument methods take
// a single variables object whose fields match the Repo parameter names.
function useRepoMutation<V, R>(run: (repo: Repo, vars: V) => Promise<R>) {
  const repo = useRepo()
  const queryClient = useQueryClient()
  return useMutation<R, Error, V>({
    mutationFn: (vars) => run(repo, vars),
    onSuccess: () => queryClient.invalidateQueries(),
  })
}

type ProfilePatch = Parameters<Repo['updateProfile']>[0]
type GearInput = Parameters<Repo['saveGear']>[0]
type ExerciseInputT = Parameters<Repo['saveExercise']>[0]
type RuleInputT = Parameters<Repo['setRule']>[1]
type ItemPatch = Parameters<Repo['updatePlanItem']>[1]
type SetPatch = Parameters<Repo['updateSet']>[1]

export const useUpdateProfile = () =>
  useRepoMutation((r, patch: ProfilePatch) => r.updateProfile(patch))
export const useSaveGear = () => useRepoMutation((r, input: GearInput) => r.saveGear(input))
export const useSaveExercise = () =>
  useRepoMutation((r, input: ExerciseInputT) => r.saveExercise(input))
export const useDeleteExercise = () => useRepoMutation((r, id: string) => r.deleteExercise(id))
export const useDeleteGear = () => useRepoMutation((r, id: string) => r.deleteGear(id))
export const useSavePlan = () =>
  useRepoMutation((r, input: { id?: string; name: string }) => r.savePlan(input))
export const useDeletePlan = () => useRepoMutation((r, id: string) => r.deletePlan(id))
export const useSavePlanDay = () =>
  useRepoMutation((r, input: Parameters<Repo['savePlanDay']>[0]) => r.savePlanDay(input))
export const useDeletePlanDay = () => useRepoMutation((r, id: string) => r.deletePlanDay(id))
export const useAddPlanItem = () =>
  useRepoMutation((r, v: { planDayId: string; exerciseId: string }) =>
    r.addPlanItem(v.planDayId, v.exerciseId),
  )
export const useUpdatePlanItem = () =>
  useRepoMutation((r, v: { id: string; patch: ItemPatch }) => r.updatePlanItem(v.id, v.patch))
export const useDeletePlanItem = () => useRepoMutation((r, id: string) => r.deletePlanItem(id))
export const useSetRule = () =>
  useRepoMutation((r, v: { planItemId: string; rule: RuleInputT }) =>
    r.setRule(v.planItemId, v.rule),
  )
/** Back to the inherited rule (exercise, profile or built-in default). */
export const useClearRule = () => useRepoMutation((r, planItemId: string) => r.clearRule(planItemId))
export const useSetExerciseRule = () =>
  useRepoMutation((r, v: { exerciseId: string; rule: RuleInputT }) => r.setExerciseRule(v.exerciseId, v.rule))
/** groupId: a client newId() for a new group; itemIds null dissolves the group. */
export const useSetSuperset = () =>
  useRepoMutation((r, v: { planDayId: string; groupId: string; itemIds: string[] | null }) =>
    r.setSuperset(v.planDayId, v.groupId, v.itemIds),
  )
export const useMove = () =>
  useRepoMutation((r, v: { kind: 'day' | 'item'; id: string; direction: -1 | 1 }) =>
    r.move(v.kind, v.id, v.direction),
  )
export const useStartSession = () =>
  useRepoMutation((r, planDayId: string) => r.startSession(planDayId))
export const useUpdateSet = () =>
  useRepoMutation((r, v: { id: string; patch: SetPatch }) => r.updateSet(v.id, v.patch))
export const useUpdateSessionNote = () =>
  useRepoMutation((r, v: { id: string; note: string }) => r.updateSessionNote(v.id, v.note))
export const useFinishSession = () => useRepoMutation((r, id: string) => r.finishSession(id))
export const useDiscardSession = () => useRepoMutation((r, id: string) => r.discardSession(id))

// Community (spec §3). Public reads use plain fetch (no session) and work in guest mode; they are
// not retried automatically (the screens offer "Try again") and stay fresh for 30 s like the API's cache.
export const useCommunityList = (q: Omit<PublicListQuery, 'cursor'>) =>
  useInfiniteQuery({
    queryKey: keys.communityList(q),
    queryFn: ({ pageParam }) => publicApi.list({ ...q, cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    maxPages: 10,
    retry: false,
    staleTime: 30_000,
  })
/** The listing and its latest version. `quiet`: a background check (plans list) that keeps results for 10 min. */
export const useCommunityPlan = (id: string, opts: { enabled?: boolean; quiet?: boolean } = {}) =>
  useQuery({
    queryKey: keys.communityPlan(id),
    queryFn: () => publicApi.plan(id),
    enabled: (opts.enabled ?? true) && idSchema.safeParse(id).success,
    retry: false,
    staleTime: opts.quiet ? 10 * 60_000 : 30_000,
    refetchOnWindowFocus: !opts.quiet,
  })
export const useHasVoted = (id: string, enabled: boolean) => {
  const repo = useRepo()
  return useQuery({ queryKey: keys.voted(id), queryFn: () => repo.hasVoted(id), enabled, retry: false })
}
export const useMyShared = (enabled: boolean) => {
  const repo = useRepo()
  return useQuery({ queryKey: keys.myShared, queryFn: () => repo.listMyShared(), enabled, retry: false })
}
type ListingMetaT = Parameters<Repo['publishPlan']>[1]
export const usePublishPlan = () =>
  useRepoMutation((r, v: { planId: string; meta: ListingMetaT }) => r.publishPlan(v.planId, v.meta))
export const useUnpublishPlan = () => useRepoMutation((r, planId: string) => r.unpublishPlan(planId))
export const useAdoptSharedPlan = () =>
  useRepoMutation((r, input: Parameters<Repo['adoptSharedPlan']>[0]) => r.adoptSharedPlan(input))

// Nutrition (signed-in only: a guest device rejects every call, so callers pass enabled=false for guests).
export const useNutrition = (date: string, enabled = true) => {
  const repo = useRepo()
  return useQuery({ queryKey: keys.nutrition(date), queryFn: () => repo.listNutrition(date, date), enabled, retry: false })
}
export const useSaveNutritionEntry = () =>
  useRepoMutation((r, entry: Parameters<Repo['saveNutritionEntry']>[0]) => r.saveNutritionEntry(entry))
export const useDeleteNutritionEntry = () => useRepoMutation((r, id: string) => r.deleteNutritionEntry(id))
// The user's own AI key: write-only, so the app only ever learns whether one is saved and where it points.
export const useAiKey = (enabled = true) => {
  const repo = useRepo()
  return useQuery({ queryKey: ['ai-key'], queryFn: () => repo.getAiKey(), enabled, retry: false })
}
export const useSaveAiKey = () => useRepoMutation((r, input: Parameters<Repo['saveAiKey']>[0]) => r.saveAiKey(input))
export const useDeleteAiKey = () => useRepoMutation((r) => r.deleteAiKey())
/** A parse writes nothing, so unlike the other mutations it does not refetch every query. */
export const useParseMeal = () => {
  const repo = useRepo()
  return useMutation<Awaited<ReturnType<Repo['parseMeal']>>, Error, string>({ mutationFn: (text) => repo.parseMeal(text) })
}
