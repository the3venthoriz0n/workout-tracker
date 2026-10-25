import type { SetLog } from '@workout/shared'
import type { SessionDetail } from '@/repo/types'

type Exercise = SessionDetail['exercises'][number]

export type SessionBlock =
  | { kind: 'exercise'; exercise: Exercise }
  | {
      kind: 'superset'
      group: string
      /** "A", from the members' snapshotted superset_label. */
      letter: string
      members: Exercise[]
      /** Every member's sets, interleaved in snapshotted `seq` order. */
      sets: { set: SetLog; exercise: Exercise }[]
    }

const groupOf = (e: Exercise) => e.sets[0]?.superset_group ?? null

/**
 * Splits a session into display blocks using only the set-log snapshots (spec §6 supersets):
 * exercises sharing a superset_group form one block whose sets follow `seq`.
 */
export function sessionBlocks(exercises: Exercise[]): SessionBlock[] {
  const blocks: SessionBlock[] = []
  const byGroup = new Map<string, Extract<SessionBlock, { kind: 'superset' }>>()
  for (const exercise of exercises) {
    const group = groupOf(exercise)
    if (group === null) {
      blocks.push({ kind: 'exercise', exercise })
      continue
    }
    let block = byGroup.get(group)
    if (!block) {
      const label = exercise.sets.find((s) => s.superset_label)?.superset_label ?? ''
      block = { kind: 'superset', group, letter: label.replace(/\d+$/, ''), members: [], sets: [] }
      byGroup.set(group, block)
      blocks.push(block)
    }
    block.members.push(exercise)
    for (const set of exercise.sets) block.sets.push({ set, exercise })
  }
  for (const b of byGroup.values()) b.sets.sort((a, z) => (a.set.seq ?? 0) - (z.set.seq ?? 0))
  return blocks
}
