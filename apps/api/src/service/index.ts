import type { ExportData, Repo } from '@workout/shared'
import type { Db } from '../db/types.js'
import { deleteExercise, exerciseUsage, listExercises, saveExercise } from './exercises.js'
import { deleteGear, listGear, saveGear } from './gear.js'
import {
  addPlanItem,
  deletePlan,
  deletePlanDay,
  deletePlanItem,
  getPlan,
  listPlans,
  move,
  savePlan,
  savePlanDay,
  setRule,
  updatePlanItem,
} from './plans.js'
import { listProgression } from './progression.js'
import { getProfile, init, updateProfile } from './profile.js'

export type Service = Repo & { importAll(data: ExportData): Promise<void> }

const notImplemented = async (): Promise<never> => {
  throw new Error('not implemented')
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

    // plans, items, rules, progression (Task 2b)
    listPlans: () => listPlans(db, userId),
    getPlan: (id) => getPlan(db, userId, id),
    savePlan: (input) => savePlan(db, userId, input),
    deletePlan: (id) => deletePlan(db, userId, id),
    savePlanDay: (input) => savePlanDay(db, userId, input),
    deletePlanDay: (id) => deletePlanDay(db, userId, id),
    addPlanItem: (dayId, exerciseId) => addPlanItem(db, userId, dayId, exerciseId),
    updatePlanItem: (id, patch) => updatePlanItem(db, userId, id, patch),
    deletePlanItem: (id) => deletePlanItem(db, userId, id),
    setRule: (itemId, rule) => setRule(db, userId, itemId, rule),
    move: (kind, id, direction) => move(db, userId, kind, id, direction),
    listProgression: () => listProgression(db, userId),

    // STUBS until Task 2c (sessions, export, import)
    getActiveSession: notImplemented,
    startSession: notImplemented,
    updateSet: notImplemented,
    updateSessionNote: notImplemented,
    finishSession: notImplemented,
    discardSession: notImplemented,
    listSessions: notImplemented,
    getSession: notImplemented,
    exportAll: notImplemented,
    importAll: notImplemented,
  }
}
