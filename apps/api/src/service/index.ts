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
import { exportAll, importAll } from './transfer.js'

export type Service = Repo & { importAll(data: ExportData): Promise<void> }

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
  }
}
