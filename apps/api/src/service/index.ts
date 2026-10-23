import type { ExportData, Repo } from '@workout/shared'
import type { Db } from '../db/types.js'
import { deleteExercise, exerciseUsage, listExercises, saveExercise } from './exercises.js'
import { deleteGear, listGear, saveGear } from './gear.js'
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

    // STUBS until Task 2b (plans, items, rules, move, progression)
    listPlans: notImplemented,
    getPlan: notImplemented,
    savePlan: notImplemented,
    deletePlan: notImplemented,
    savePlanDay: notImplemented,
    deletePlanDay: notImplemented,
    addPlanItem: notImplemented,
    updatePlanItem: notImplemented,
    deletePlanItem: notImplemented,
    setRule: notImplemented,
    move: notImplemented,
    listProgression: notImplemented,

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
