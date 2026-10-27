import type { ExportData, PlanItem, Repo } from '@workout/shared'
import type { Db } from '../db/types.js'
import { deleteExercise, exerciseUsage, listExercises, saveExercise, setExerciseRule } from './exercises.js'
import { deleteGear, listGear, saveGear } from './gear.js'
import {
  addPlanItem,
  clearRule,
  deletePlan,
  deletePlanDay,
  deletePlanItem,
  getPlan,
  listPlans,
  move,
  savePlan,
  savePlanDay,
  setRule,
  setSuperset,
  updatePlanItem,
} from './plans.js'
import { listProgression, listProgressionByExercise } from './progression.js'
import { getProfile, init, updateProfile } from './profile.js'
import {
  discardSession,
  finishSession,
  getActiveSession,
  getSession,
  listSessions,
  startSession,
  updateSessionNote,
  updateSet,
} from './sessions.js'
import { owns, type OwnedKind } from './ownership.js'
import { exportAll, importAll } from './transfer.js'
import { adoptSharedPlan, hasVoted, listMyShared, publishPlan, setVote, unpublishPlan } from './community.js'

export type Service = Repo & {
  importAll(data: ExportData): Promise<void>
  addPlanItem(planDayId: string, exerciseId: string, id?: string): Promise<PlanItem>
  /** True when `id` is a live row of this kind owned by the user (used for 404 on deletes). */
  owns(kind: OwnedKind, id: string): Promise<boolean>
}

export function createService(db: Db, userId: string): Service {
  return {
    // profile, gear, exercises (Task 2a)
    init: () => init(db, userId),
    getProfile: () => getProfile(db, userId),
    updateProfile: (patch) => updateProfile(db, userId, patch),
    listGear: () => listGear(db, userId),
    saveGear: (input) => saveGear(db, userId, input),
    deleteGear: (id) => deleteGear(db, userId, id),
    listExercises: () => listExercises(db, userId),
    saveExercise: (input) => saveExercise(db, userId, input),
    deleteExercise: (id) => deleteExercise(db, userId, id),
    exerciseUsage: (id) => exerciseUsage(db, userId, id),
    setExerciseRule: (id, rule) => setExerciseRule(db, userId, id, rule),

    // plans, items, rules, progression (Task 2b)
    listPlans: () => listPlans(db, userId),
    getPlan: (id) => getPlan(db, userId, id),
    savePlan: (input) => savePlan(db, userId, input),
    deletePlan: (id) => deletePlan(db, userId, id),
    savePlanDay: (input) => savePlanDay(db, userId, input),
    deletePlanDay: (id) => deletePlanDay(db, userId, id),
    addPlanItem: (dayId: string, exerciseId: string, id?: string) => addPlanItem(db, userId, dayId, exerciseId, id),
    updatePlanItem: (id, patch) => updatePlanItem(db, userId, id, patch),
    deletePlanItem: (id) => deletePlanItem(db, userId, id),
    setRule: (itemId, rule) => setRule(db, userId, itemId, rule),
    clearRule: (itemId) => clearRule(db, userId, itemId),
    setSuperset: (dayId, groupId, itemIds) => setSuperset(db, userId, dayId, groupId, itemIds),
    move: (kind, id, direction) => move(db, userId, kind, id, direction),
    listProgression: () => listProgression(db, userId),
    listProgressionByExercise: () => listProgressionByExercise(db, userId),

    // sessions, export, import (Task 2c)
    getActiveSession: () => getActiveSession(db, userId),
    startSession: (planDayId) => startSession(db, userId, planDayId),
    updateSet: (id, patch) => updateSet(db, userId, id, patch),
    updateSessionNote: (id, note) => updateSessionNote(db, userId, id, note),
    finishSession: (id) => finishSession(db, userId, id),
    discardSession: (id) => discardSession(db, userId, id),
    listSessions: () => listSessions(db, userId),
    getSession: (id) => getSession(db, userId, id),
    exportAll: () => exportAll(db, userId),
    importAll: (data) => importAll(db, userId, data),
    owns: (kind, id) => owns(db, userId, kind, id),

    // community plans
    publishPlan: (planId, meta) => publishPlan(db, userId, planId, meta),
    unpublishPlan: (planId) => unpublishPlan(db, userId, planId),
    listMyShared: () => listMyShared(db, userId),
    adoptSharedPlan: (input) => adoptSharedPlan(db, userId, input),
    setVote: (id, voted) => setVote(db, userId, id, voted),
    hasVoted: (id) => hasVoted(db, userId, id),
  }
}
