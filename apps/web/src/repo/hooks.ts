import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
  exerciseUsage: (id: string) => ['exercise-usage', id] as const,
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
export const useSession = (id: string) => {
  const repo = useRepo()
  return useQuery({ queryKey: keys.session(id), queryFn: async () => (await repo.getSession(id)) ?? null })
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
  useRepoMutation((r, input: { id?: string; plan_id: string; name: string }) =>
    r.savePlanDay(input),
  )
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
