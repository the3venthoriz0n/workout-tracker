import { randomUUID } from 'node:crypto'
import { runRepoContract } from '@workout/shared/testing'
import { user } from '../src/db/schema.js'
import { createService } from '../src/service/index.js'
import { withTestDb } from './harness.js'

runRepoContract(
  'Service (Postgres)',
  async () => {
    const { db, cleanup } = await withTestDb()
    const userId = `u_${randomUUID()}`
    await db.insert(user).values({ id: userId, name: userId, email: `${userId}@example.test` })
    const repo = createService(db, userId)
    await repo.init()
    return { repo, cleanup }
  },
  // Sessions and import arrive in Task 2c; those groups are added there.
  {
    groups: ['profile', 'gear', 'exercises', 'plans', 'progression'],
    // These cases drive startSession/finishSession/exportAll, which arrive in Task 2c (remove then).
    pending: [
      'unit switch converts exercise defaults, item weights/targets, set-log weights and add_weight rule amounts, and resets the step',
      'deleteExercise cascades to its live plan items and keeps history names',
      'addPlanItem uses default_rule when set, else the default rule',
      "editing an item's reps or weight clears targets and the fail streak",
    ],
  },
)
